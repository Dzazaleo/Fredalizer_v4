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
  });

  const abortControllerRef = useRef<AbortController | null>(null);
  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rawDetectionsRef = useRef<number[]>([]);

  useEffect(() => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    videoElementRef.current = video;

    const canvas = document.createElement('canvas');
    canvasRef.current = canvas;

    return () => {
      if (videoElementRef.current) {
        videoElementRef.current.pause();
        videoElementRef.current.removeAttribute('src');
        videoElementRef.current.load();
      }
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, []);

  // Updated Signature: Returns Promise<DetectionRange[]>
  const processVideo = useCallback(async (videoUrl: string, referenceImageUrl: string): Promise<DetectionRange[]> => {
    if (typeof cv === 'undefined') {
      console.error("OpenCV is not loaded");
      setState(prev => ({ ...prev, status: 'error' }));
      throw new Error("OpenCV not loaded");
    }

    setState({
      isProcessing: true,
      progress: 0,
      status: 'initializing',
    });
    rawDetectionsRef.current = [];

    if (abortControllerRef.current) abortControllerRef.current.abort();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    const { signal } = abortController;

    try {
      // --- Phase 1: Calibration ---
      setState(prev => ({ ...prev, status: 'calibrating' }));
      const referenceImage = new Image();
      referenceImage.crossOrigin = "anonymous";
      referenceImage.src = referenceImageUrl;
      await new Promise((resolve, reject) => {
        referenceImage.onload = resolve;
        referenceImage.onerror = reject;
      });

      if (signal.aborted) throw new Error("Aborted");
      const profile: VisionProfile = calibrateReference(referenceImage);

      // --- Phase 2: Processing ---
      setState(prev => ({ ...prev, status: 'processing' }));
      const video = videoElementRef.current!;
      const canvas = canvasRef.current!;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error("No Context");

      video.src = videoUrl;
      await new Promise((resolve, reject) => {
        video.onloadeddata = resolve;
        video.onerror = reject;
      });

      if (signal.aborted) throw new Error("Aborted");

      // Logic 1 (Temporal Resolution): Set playbackRate to 0.5x for accuracy
      video.playbackRate = 0.5;

      const processWidth = 640;
      const scale = processWidth / video.videoWidth;
      const processHeight = video.videoHeight * scale;
      canvas.width = processWidth;
      canvas.height = processHeight;

      await new Promise<void>(async (resolve, reject) => {
        video.onended = () => resolve();
        video.onerror = (e) => reject(e);

        let frameCount = 0;
        const processFrame = async (now: number, metadata: any) => {
          if (signal.aborted) {
            video.pause();
            return;
          }
          try {
            ctx.drawImage(video, 0, 0, processWidth, processHeight);
            let mat: any = null;
            try {
              const imageData = ctx.getImageData(0, 0, processWidth, processHeight);
              mat = cv.matFromImageData(imageData);
              const isDetected = scanFrame(mat, profile, false);
              if (isDetected) rawDetectionsRef.current.push(metadata.mediaTime);
            } finally {
              if (mat) mat.delete();
            }

            frameCount++;
            if (frameCount % 30 === 0) {
              const prog = Math.min(100, Math.round((metadata.mediaTime / video.duration) * 100));
              setState(prev => ({ ...prev, progress: prog }));
            }

            if (!video.paused && !video.ended) {
              (video as any).requestVideoFrameCallback(processFrame);
            }
          } catch (e) {
            console.error("Frame error", e);
          }
        };
        (video as any).requestVideoFrameCallback(processFrame);
        await video.play();
      });

      // --- Phase 3: Finalize ---
      const ranges = processDetections(rawDetectionsRef.current);
      setState(prev => ({ ...prev, status: 'completed', progress: 100, isProcessing: false }));
      return ranges;

    } catch (error: any) {
      if (!signal.aborted) {
        console.error("Processing Error:", error);
        setState(prev => ({ ...prev, status: 'error', isProcessing: false }));
        throw error;
      }
      return [];
    }
  }, []);

  return {
    ...state,
    processVideo
  };
};