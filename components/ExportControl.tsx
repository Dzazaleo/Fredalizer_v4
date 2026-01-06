import React from 'react';
import { Download, Film, FileJson } from 'lucide-react';
import { Button } from './Button';
import { Range } from '../utils/ffmpegBuilder';

interface ExportControlProps {
  keepRanges: Range[];
  onExport: () => void;
  isProcessing: boolean;
  progress: number;
  status: string;
}

export const ExportControl: React.FC<ExportControlProps> = ({ keepRanges }) => {

  const handleDownloadJson = () => {
    // 1. Create the cut list data
    const data = JSON.stringify(keepRanges, null, 2);
    
    // 2. Download it as a JSON file
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cut-list.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-green-500/10 text-green-500 rounded-lg">
            <Film size={24} />
          </div>
          <div>
            <h3 className="font-semibold text-slate-200">Local Export Ready</h3>
            <p className="text-sm text-slate-500">
              {keepRanges.length} segments identified
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 text-sm text-slate-400">
          <p className="flex items-center gap-2">
            <FileJson size={16} className="text-blue-500" />
            <span>Hybrid Mode: Download JSON to render locally.</span>
          </p>
        </div>

        <Button 
          onClick={handleDownloadJson}
          className="w-full flex items-center justify-center gap-2 py-3"
          disabled={keepRanges.length === 0}
        >
          <Download size={18} />
          Download Cut List (JSON)
        </Button>
      </div>
    </div>
  );
};