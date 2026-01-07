import { useState, useRef, useCallback, useEffect } from 'react';
import { calibrateReference, VisionProfile } from '../utils/visionCalibration';
import { scanFrame } from '../utils/visionDetection';

export interface DetectionRange {
  start: number;
  end: number;
  confidence: number;
}

interface VisionState {
  isProcessing: boolean;
  progress: number;
  status: 'idle' | 'initializing' | 'calibrating' | 'processing' | 'completed' | 'error';
  detections: DetectionRange[];
}

// Access global OpenCV instance
declare var cv: any;

function processDetections(timestamps: number[]): DetectionRange[] {
  if (timestamps.length === 0) return [];

  const sorted = [...timestamps].sort((a, b) => a - b);
  const ranges: DetectionRange[] = [];
  
  let start = sorted[0];
  let prev = sorted[0];
  const TOLERANCE = 0.5;

  for (let i = 1; i < sorted.length; i++) {
    const curr = sorted[i];
    if (curr - prev > TOLERANCE) {
      ranges.push({ start, end: prev, confidence: 1.0 });
      start = curr;
    }
    prev = curr;
  }
  ranges.push({ start, end: prev, confidence: 1.0 });

  return ranges;
}

export const useVisionEngine = () => {
  const [state, setState] = useState<VisionState>({
    isProcessing: false,
    progress: 0,
    status: 'idle',
    detections: []
  });

  const abortControllerRef = useRef<AbortController | null>(null);
  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rawDetectionsRef = useRef<number[]>([]);
  const lastProcessedTimeRef = useRef<number>(-1);

  // 1. Setup Video Element with "Ghost Mount"
  useEffect(() => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';

    // Mount to DOM to prevent browser throttling
    video.style.position = 'fixed';
    video.style.top = '0';
    video.style.left = '0';
    video.style.width = '1px';
    video.style.height = '1px';
    video.style.opacity = '0.01'; // Not 0, to avoid "invisible" optimization
    video.style.pointerEvents = 'none';
    video.style.zIndex = '-9999';
    
    document.body.appendChild(video);
    videoElementRef.current = video;

    const canvas = document.createElement('canvas');
    canvasRef.current = canvas;

    return () => {
      // Cleanup: Remove from DOM
      if (videoElementRef.current && document.body.contains(videoElementRef.current)) {
        document.body.removeChild(videoElementRef.current);
      }
      if (videoElementRef.current) {
        videoElementRef.current.pause();
        videoElementRef.current.removeAttribute('src');
        videoElementRef.current.load();
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const processVideo = useCallback(async (videoUrl: string, referenceImageUrl: string): Promise<DetectionRange[]> => {
    if (typeof cv === 'undefined') {
      console.error("OpenCV is not loaded");
      setState(prev => ({ ...prev, status: 'error' }));
      return [];
    }

    setState({
      isProcessing: true,
      progress: 0,
      status: 'initializing',
      detections: []
    });
    rawDetectionsRef.current = [];
    lastProcessedTimeRef.current = -1;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    const { signal } = abortController;

    try {
      setState(prev => ({ ...prev, status: 'calibrating' }));
      
      const referenceImage = new Image();
      referenceImage.crossOrigin = "anonymous";
      referenceImage.src = referenceImageUrl;
      
      await new Promise((resolve, reject) => {
        referenceImage.onload = resolve;
        referenceImage.onerror = reject;
      });

      if (signal.aborted) return [];
      const profile: VisionProfile = calibrateReference(referenceImage);

      setState(prev => ({ ...prev, status: 'processing' }));
      
      const video = videoElementRef.current!;
      const canvas = canvasRef.current!;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error("Could not get canvas context");

      video.src = videoUrl;
      video.playbackRate = 2.0; // PROCESS 2x SPEED
      
      // Wait for metadata so we know duration
      await new Promise((resolve) => {
        video.onloadedmetadata = resolve;
      });

      const processWidth = 640;
      const scale = processWidth / video.videoWidth;
      const processHeight = video.videoHeight * scale;
      canvas.width = processWidth;
      canvas.height = processHeight;

      await new Promise<void>(async (resolve, reject) => {
        video.onended = () => resolve();
        video.onerror = (e) => reject(e);

        // Frame Sampling Config
        const SAMPLE_INTERVAL = 0.1; // 10 FPS effective scanning rate
        let uiUpdateCounter = 0;
        
        const processFrame = async (now: number, metadata: any) => {
          if (signal.aborted) {
            video.pause();
            return;
          }

          try {
            // THROTTLE: Only process if time advanced significantly
            // This prevents the main thread from choking on every single refresh (60hz)
            const currentTime = metadata.mediaTime;
            
            if (currentTime - lastProcessedTimeRef.current >= SAMPLE_INTERVAL) {
              lastProcessedTimeRef.current = currentTime;

              // 1. Draw Frame
              ctx.drawImage(video, 0, 0, processWidth, processHeight);
              
              // 2. Scan (Scoped Memory Management)
              let mat: any = null;
              try {
                const imageData = ctx.getImageData(0, 0, processWidth, processHeight);
                mat = cv.matFromImageData(imageData);
                const isDetected = scanFrame(mat, profile, false); 

                if (isDetected) {
                  rawDetectionsRef.current.push(currentTime);
                }
              } finally {
                if (mat) mat.delete();
              }
            }

            uiUpdateCounter++;
            // Update UI every ~30 frames of playback (approx every 0.5 - 1s real time)
            if (uiUpdateCounter % 30 === 0) {
              const progress = Math.min(100, Math.round((metadata.mediaTime / video.duration) * 100));
              setState(prev => ({ ...prev, progress }));
              
              // CRITICAL: Yield to main thread to allow UI render & prevent freeze
              await new Promise(r => setTimeout(r, 0));
            }

            if (!video.paused && !video.ended) {
              (video as any).requestVideoFrameCallback(processFrame);
            }
          } catch (e) {
            console.error("Frame processing error:", e);
          }
        };

        (video as any).requestVideoFrameCallback(processFrame);
        await video.play();
      });

      if (!signal.aborted) {
        const ranges = processDetections(rawDetectionsRef.current);
        
        setState(prev => ({ 
          ...prev, 
          status: 'completed', 
          progress: 100, 
          isProcessing: false,
          detections: ranges
        }));
        
        return ranges;
      }

    } catch (error) {
      if (!signal.aborted) {
        console.error("[VisionEngine] Processing Error:", error);
        setState(prev => ({ ...prev, status: 'error', isProcessing: false }));
      }
    }
    return [];
  }, []);

  return {
    ...state,
    processVideo
  };
};