import React, { useState, useEffect, useCallback } from 'react';
import { VideoDropZone } from './components/VideoDropZone';
import { ReferenceImageDropZone } from './components/ReferenceImageDropZone';
import { ReferenceAsset, QueueItem, ProcessingStatus } from './types';
import { Clapperboard, Sparkles, Trash2, Download, FileVideo, CheckCircle2, Loader2, AlertTriangle, Clock } from 'lucide-react';
import { Button } from './components/Button';
import { useVisionEngine, DetectionRange } from './hooks/useVisionEngine';
import { Range } from './utils/ffmpegBuilder';

const App: React.FC = () => {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [referenceAsset, setReferenceAsset] = useState<ReferenceAsset | null>(null);
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [isAddingToQueue, setIsAddingToQueue] = useState(false);
  
  // Vision Engine Hook
  const { 
    progress: visionProgress, 
    processVideo: runVision 
  } = useVisionEngine();

  // Helper: Robust ID Generation (Polyfill for non-secure contexts)
  const generateId = () => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  };

  // Helper to load duration with Timeout Safety & DOM Mounting
  const getVideoDuration = (url: string): Promise<number> => {
    return new Promise((resolve) => {
      const vid = document.createElement('video');
      vid.preload = 'metadata';
      vid.muted = true;
      vid.playsInline = true;
      
      // Fix: Use off-screen positioning instead of display:none to ensure metadata loads
      vid.style.position = 'fixed';
      vid.style.top = '-9999px';
      vid.style.left = '-9999px';
      vid.style.opacity = '0';
      vid.style.pointerEvents = 'none';
      vid.style.width = '1px';
      vid.style.height = '1px';
      
      document.body.appendChild(vid);

      const cleanup = () => {
        if (document.body.contains(vid)) {
          document.body.removeChild(vid);
        }
        vid.removeAttribute('src');
        vid.load();
      };
      
      // Safety timeout: Extended to 30s for large files (1GB+)
      const timeoutId = setTimeout(() => {
        console.warn("Video metadata load timed out (30s limit) for:", url);
        cleanup();
        resolve(0);
      }, 30000);

      vid.onloadedmetadata = () => {
        clearTimeout(timeoutId);
        // Sanity check: ensure duration is finite
        const duration = Number.isFinite(vid.duration) ? vid.duration : 0;
        resolve(duration);
        cleanup();
      };

      vid.onerror = () => {
        clearTimeout(timeoutId);
        console.error("Video load error for:", url);
        // Resolve 0 instead of rejecting to keep the batch alive
        resolve(0);
        cleanup();
      };

      vid.src = url;
    });
  };

  const handleFilesSelected = async (files: File[]) => {
    setIsAddingToQueue(true);
    try {
      // Generate items
      const newItems: QueueItem[] = await Promise.all(files.map(async (file) => {
        const url = URL.createObjectURL(file);
        const duration = await getVideoDuration(url);
        return {
          id: generateId(),
          asset: { file, previewUrl: url, duration },
          status: ProcessingStatus.PENDING,
          progress: 0,
          detections: []
        };
      }));

      setQueue(prev => [...prev, ...newItems]);
    } catch (err) {
      console.error("Error adding files to queue:", err);
    } finally {
      setIsAddingToQueue(false);
    }
  };

  const handleReferenceSelected = useCallback((file: File, url: string) => {
    setReferenceAsset({ file, previewUrl: url });
  }, []);

  const handleRemoveItem = (id: string) => {
    setQueue(prev => {
      const item = prev.find(i => i.id === id);
      if (item) URL.revokeObjectURL(item.asset.previewUrl);
      return prev.filter(i => i.id !== id);
    });
  };

  /**
   * Calculates "Keep" ranges (Hybrid Cut List logic)
   */
  const calculateKeepRanges = (detections: DetectionRange[], duration: number): Range[] => {
    if (duration === 0) return [];
    if (detections.length === 0) return [{ start: 0, end: duration }];

    const FRAME_MARGIN = 0.05; 
    const sorted = [...detections].sort((a, b) => a.start - b.start);
    const keep: Range[] = [];
    let currentCursor = 0;

    sorted.forEach(det => {
      const safeEnd = Math.max(0, det.start - FRAME_MARGIN);
      if (safeEnd > currentCursor + 0.1) {
        keep.push({ start: currentCursor, end: safeEnd });
      }
      currentCursor = Math.max(currentCursor, Math.min(duration, det.end + FRAME_MARGIN));
    });

    if (currentCursor < duration - 0.1) {
      keep.push({ start: currentCursor, end: duration });
    }
    
    return keep;
  };

  const processQueue = async () => {
    if (!referenceAsset) return;
    setIsBatchProcessing(true);

    const itemIds = queue.map(i => i.id);

    for (const id of itemIds) {
      let currentItem = queue.find(i => i.id === id);
      
      if (!currentItem || currentItem.status === ProcessingStatus.COMPLETED) continue;

      setActiveJobId(id);
      
      setQueue(prev => prev.map(item => 
        item.id === id ? { ...item, status: ProcessingStatus.PROCESSING } : item
      ));

      try {
        const detections = await runVision(currentItem.asset.previewUrl, referenceAsset.previewUrl);
        const ranges = calculateKeepRanges(detections, currentItem.asset.duration);

        setQueue(prev => prev.map(item => 
          item.id === id ? { 
            ...item, 
            status: ProcessingStatus.COMPLETED, 
            detections, 
            resultRanges: ranges,
            progress: 100 
          } : item
        ));

        URL.revokeObjectURL(currentItem.asset.previewUrl);

        // DELAY for Garbage Collection Stability
        await new Promise(r => setTimeout(r, 500));

      } catch (err) {
        console.error(`Failed to process ${currentItem?.asset?.file?.name}`, err);
        setQueue(prev => prev.map(item => 
          item.id === id ? { ...item, status: ProcessingStatus.ERROR } : item
        ));
        
        if (currentItem) {
            URL.revokeObjectURL(currentItem.asset.previewUrl);
        }
      }
    }

    setActiveJobId(null);
    setIsBatchProcessing(false);
  };

  const downloadBatchJson = () => {
    const manifest = queue
      .filter(item => item.status === ProcessingStatus.COMPLETED)
      .map(item => ({
        file: item.asset.file.name,
        duration: item.asset.duration,
        keepRanges: item.resultRanges || [],
        detections: item.detections
      }));

    const data = JSON.stringify(manifest, null, 2);
    
    // Generate Unique Name: batch-cut-list-{timestamp}-{random}.json
    const timestamp = new Date().getTime();
    const randomSuffix = Math.random().toString(36).substring(2, 7);
    const fileName = `batch-cut-list-${timestamp}-${randomSuffix}.json`;

    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col font-sans">
      {/* Navbar */}
      <header className="bg-slate-900 border-b border-slate-800 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-blue-600 p-1.5 rounded-lg text-white">
              <Clapperboard size={20} />
            </div>
            <h1 className="text-xl font-bold text-slate-100 tracking-tight">Fredalizer<span className="text-blue-500">Batch</span></h1>
          </div>
          <div className="flex items-center gap-4 text-sm text-slate-500">
             <span>v4.0 Batch</span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          
          {/* Left Column: Configuration & Uploader (4 cols) */}
          <div className="lg:col-span-4 space-y-6">
            <div className="bg-slate-900 p-6 rounded-2xl shadow-sm border border-slate-800 space-y-6">
              <h3 className="font-semibold text-slate-200">1. Define Target</h3>
              <ReferenceImageDropZone onImageLoaded={handleReferenceSelected} />
            </div>

            <div className="bg-slate-900 p-6 rounded-2xl shadow-sm border border-slate-800 space-y-6">
               <h3 className="font-semibold text-slate-200">2. Add Footage</h3>
               <VideoDropZone onFilesSelected={handleFilesSelected} />
               <p className="text-xs text-slate-500 text-center">
                 {isAddingToQueue ? (
                   <span className="flex items-center justify-center gap-2 text-blue-400">
                     <Loader2 className="animate-spin w-3 h-3" /> Processing inputs...
                   </span>
                 ) : (
                   <>{queue.length} items in queue</>
                 )}
               </p>
            </div>

             <div className="bg-slate-900 p-6 rounded-2xl shadow-sm border border-slate-800">
                <Button 
                  className="w-full flex items-center justify-center gap-2 py-3" 
                  disabled={!referenceAsset || queue.length === 0 || isBatchProcessing || isAddingToQueue}
                  onClick={processQueue}
                >
                  {isBatchProcessing ? <Loader2 className="animate-spin" /> : <Sparkles size={18} />}
                  {isBatchProcessing ? 'Processing Queue...' : 'Run Batch Analysis'}
                </Button>
             </div>
          </div>

          {/* Right Column: Queue List (8 cols) */}
          <div className="lg:col-span-8 space-y-4">
             <div className="flex items-center justify-between mb-2">
               <h2 className="text-xl font-bold text-slate-200">Processing Queue</h2>
               <Button 
                 variant="secondary" 
                 disabled={!queue.some(i => i.status === ProcessingStatus.COMPLETED)}
                 onClick={downloadBatchJson}
                 className="flex gap-2 text-sm"
               >
                 <Download size={14} /> Download Manifest
               </Button>
             </div>

             {queue.length === 0 ? (
               <div className="h-64 flex flex-col items-center justify-center border-2 border-dashed border-slate-800 rounded-2xl text-slate-600 bg-slate-900/50">
                 <FileVideo size={48} className="mb-4 opacity-50" />
                 <p>{isAddingToQueue ? 'Reading metadata...' : 'Queue is empty. Add videos to begin.'}</p>
               </div>
             ) : (
               <div className="space-y-3">
                 {queue.map((item) => (
                   <div 
                     key={item.id} 
                     className={`
                       relative overflow-hidden rounded-xl border p-4 transition-all
                       ${item.status === ProcessingStatus.PROCESSING 
                         ? 'bg-blue-900/10 border-blue-500/50' 
                         : 'bg-slate-900 border-slate-800'
                       }
                     `}
                   >
                      <div className="flex items-center justify-between z-10 relative">
                        {/* File Info */}
                        <div className="flex items-center gap-4">
                          <div className={`p-2 rounded-lg ${item.status === ProcessingStatus.COMPLETED ? 'bg-green-500/20 text-green-500' : 'bg-slate-800 text-slate-400'}`}>
                            {item.status === ProcessingStatus.PROCESSING ? <Loader2 className="animate-spin" size={20} /> :
                             item.status === ProcessingStatus.COMPLETED ? <CheckCircle2 size={20} /> :
                             item.status === ProcessingStatus.ERROR ? <AlertTriangle size={20} className="text-red-500" /> :
                             <FileVideo size={20} />}
                          </div>
                          <div>
                             <h4 className="font-medium text-slate-200 text-sm">{item.asset.file.name}</h4>
                             <div className="flex items-center gap-3 text-xs text-slate-500 mt-1">
                               <span>{(item.asset.file.size / (1024*1024)).toFixed(1)} MB</span>
                               <span>•</span>
                               <span className="flex items-center gap-1"><Clock size={10} /> {item.asset.duration.toFixed(1)}s</span>
                             </div>
                          </div>
                        </div>

                        {/* Status/Actions */}
                        <div className="flex items-center gap-4">
                           {item.status === ProcessingStatus.COMPLETED && (
                             <div className="text-right">
                               <span className="block text-lg font-bold text-green-400">{item.resultRanges?.length || 0}</span>
                               <span className="text-xs text-slate-500 uppercase">Cuts</span>
                             </div>
                           )}
                           
                           {item.status === ProcessingStatus.PROCESSING && (
                             <div className="w-24 text-right">
                               <span className="text-lg font-bold text-blue-400">{visionProgress}%</span>
                             </div>
                           )}

                           <button 
                             onClick={() => handleRemoveItem(item.id)}
                             disabled={isBatchProcessing}
                             className="p-2 text-slate-600 hover:text-red-400 hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-30"
                           >
                             <Trash2 size={16} />
                           </button>
                        </div>
                      </div>

                      {/* Progress Bar Background */}
                      {item.status === ProcessingStatus.PROCESSING && (
                        <div 
                          className="absolute bottom-0 left-0 h-1 bg-blue-500 transition-all duration-300" 
                          style={{ width: `${visionProgress}%` }}
                        />
                      )}
                      {item.status === ProcessingStatus.COMPLETED && (
                        <div className="absolute bottom-0 left-0 h-1 w-full bg-green-500/50" />
                      )}
                   </div>
                 ))}
               </div>
             )}
          </div>

        </div>
      </main>
    </div>
  );
};

export default App;