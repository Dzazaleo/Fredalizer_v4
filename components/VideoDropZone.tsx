import React, { useState, useCallback, useRef } from 'react';
import { Upload, FileVideo, AlertCircle } from 'lucide-react';
import { VideoFilesHandler, UploadError } from '../types';

interface VideoDropZoneProps {
  onFilesSelected: VideoFilesHandler;
}

export const VideoDropZone: React.FC<VideoDropZoneProps> = ({ onFilesSelected }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validateFile = (file: File): boolean => {
    // Some browsers/OSes might report empty string for file.type on MKV/MOV/etc.
    // We check either valid MIME type OR valid extension.
    const validTypes = ['video/mp4', 'video/quicktime'];
    const validExtensions = ['.mp4', '.mov'];
    const fileExtension = '.' + file.name.split('.').pop()?.toLowerCase();

    // Condition: Is INVALID if (Type is NOT in list AND Extension is NOT in list)
    if (!validTypes.includes(file.type) && !validExtensions.includes(fileExtension)) {
      console.warn(`[VideoDropZone] Skipped file: ${file.name} | Type: ${file.type} | Ext: ${fileExtension}`);
      return false;
    }
    return true;
  };

  const processFiles = useCallback((fileList: FileList | null) => {
    setError(null);
    if (!fileList || fileList.length === 0) return;

    const validFiles: File[] = [];
    let hasInvalid = false;

    Array.from(fileList).forEach(file => {
      if (validateFile(file)) {
        validFiles.push(file);
      } else {
        hasInvalid = true;
      }
    });

    if (hasInvalid) {
      setError(UploadError.INVALID_TYPE + " Check console for details.");
    }

    if (validFiles.length > 0) {
      onFilesSelected(validFiles);
    }
    
    // Reset input to ensure same-file selection works
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [onFilesSelected]);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      processFiles(files);
    }
  }, [processFiles]);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    processFiles(e.target.files);
  }, [processFiles]);

  const handleZoneClick = () => {
    fileInputRef.current?.click();
  };

  const getBorderColor = () => {
    if (error) return 'border-red-500/50 bg-red-900/10';
    if (isDragging) return 'border-blue-500 bg-blue-500/10';
    return 'border-slate-700 hover:border-slate-600 bg-slate-900 hover:bg-slate-800/50';
  };

  return (
    <div className="w-full">
      <div
        onClick={handleZoneClick}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`
          relative group cursor-pointer
          flex flex-col items-center justify-center
          p-10
          border-2 border-dashed rounded-2xl
          transition-all duration-200 ease-in-out
          ${getBorderColor()}
        `}
      >
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileInputChange}
          accept=".mp4,.mov,video/mp4,video/quicktime"
          multiple // Enabled for batching
          className="hidden"
          aria-label="Upload video"
        />

        <div className={`
          p-3 rounded-full mb-3 transition-colors duration-200
          ${error 
            ? 'bg-red-900/30 text-red-400' 
            : isDragging 
              ? 'bg-blue-900/30 text-blue-400' 
              : 'bg-slate-800 text-slate-400 group-hover:bg-slate-700 group-hover:text-slate-300'
          }
        `}>
          {error ? <AlertCircle size={24} /> : <Upload size={24} />}
        </div>

        <div className="text-center space-y-1">
          <h3 className={`text-base font-semibold ${error ? 'text-red-400' : 'text-slate-200'}`}>
            {error ? 'Upload Warning' : isDragging ? 'Drop videos here' : 'Add Videos to Queue'}
          </h3>
          
          <p className="text-slate-500 text-xs">
            MP4 / MOV • Batch Supported
          </p>
        </div>
      </div>
      {error && <p className="text-red-400 text-xs text-center mt-2">{error}</p>}
    </div>
  );
};