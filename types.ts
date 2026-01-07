export interface VideoAsset {
  file: File;
  previewUrl: string;
  duration: number; // Added duration for easier range calc
}

export interface ReferenceAsset {
  file: File;
  previewUrl: string;
}

export enum ProcessingStatus {
  IDLE = 'idle',
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  ERROR = 'error'
}

export interface QueueItem {
  id: string; // unique ID
  asset: VideoAsset;
  status: ProcessingStatus;
  progress: number;
  detections: { start: number; end: number; confidence: number }[];
  resultRanges?: { start: number; end: number }[]; // The "Keep" ranges
}

export type VideoFilesHandler = (files: File[]) => void;
export type ReferenceImageHandler = (file: File, url: string) => void;

export enum UploadError {
  INVALID_TYPE = "Invalid file type. Please upload MP4 or QuickTime files.",
  INVALID_IMAGE_TYPE = "Invalid format. Please upload a PNG, JPG, or WebP screenshot.",
  GENERIC = "An error occurred while processing the file.",
}