import React, { useRef } from 'react';
import { UploadCloud } from 'lucide-react';

interface FileUploadProps {
  onFileSelect: (file: File) => void;
  isLoading: boolean;
  spatialCalibration: number;
  onSpatialCalibrationChange: (value: number) => void;
  calibrationStatus: 'not-tested' | 'testing' | 'ready';
  onCalibrationTest: () => void;
  allowUpload: boolean;
}

export function FileUpload({ onFileSelect, isLoading, spatialCalibration, onSpatialCalibrationChange, calibrationStatus, onCalibrationTest, allowUpload }: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (!allowUpload) return;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (file.type.startsWith('audio/')) onFileSelect(file);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!allowUpload) return;
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      if (file.type.startsWith('audio/')) onFileSelect(file);
    }
  };

  return (
    <div 
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      onClick={() => {
        if (isLoading || !allowUpload) return;
        inputRef.current?.click();
      }}
      className={`border-2 border-dashed rounded-xl p-12 flex flex-col items-center justify-center transition-all ${
        isLoading ? 'border-zinc-800 opacity-50 cursor-not-allowed' : allowUpload ? 'border-zinc-700 hover:border-lime-400 hover:bg-zinc-900/50 cursor-pointer' : 'border-amber-500/40 bg-zinc-900/80 cursor-not-allowed'
      }`}
    >
        <UploadCloud className={`w-12 h-12 mb-4 ${isLoading ? 'text-zinc-600 animate-pulse' : 'text-zinc-500'}`} />
        <h3 className="text-lg font-bold text-zinc-100 mb-2">
            {isLoading ? 'Processing Multi-Band Isolation...' : 'Upload Master Track for Expert 8D Generation'}
        </h3>
        <p className="text-sm text-zinc-400 text-center max-w-md">
            {isLoading 
              ? 'Executing DSP crossover networks, calculating psychoacoustic matrices, and plotting vector orbits...' 
              : 'Our expert engine uses steep crossover networks to split your track into 4 distinct bands (Bass, Drums, Vocals, Synths). It then applies strict psychoacoustic HRTF rules (e.g. static centered bass) to generate an incredibly immersive, nausea-free 3D environment.'}
        </p>

        <div className="mt-6 w-full space-y-4 rounded-xl border border-zinc-800 bg-zinc-950/70 p-4 text-left">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">3D Calibration</p>
              <p className="text-[11px] text-zinc-400">Set the depth scale and test before uploading.</p>
            </div>
            <span className={`text-xs font-mono px-2 py-1 rounded-full ${calibrationStatus === 'ready' ? 'bg-lime-500/10 text-lime-300' : calibrationStatus === 'testing' ? 'bg-amber-500/10 text-amber-300' : 'bg-zinc-800 text-zinc-500'}`}>
              {calibrationStatus === 'ready' ? 'Calibrated' : calibrationStatus === 'testing' ? 'Testing...' : 'Not tested'}
            </span>
          </div>
          <input
            type="range"
            min="0.8"
            max="1.4"
            step="0.02"
            value={spatialCalibration}
            onChange={(e) => onSpatialCalibrationChange(parseFloat(e.target.value))}
            disabled={isLoading}
            className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] text-zinc-400">Depth: {(spatialCalibration * 100).toFixed(0)}%</span>
            <button
              type="button"
              onClick={onCalibrationTest}
              disabled={isLoading || calibrationStatus === 'testing'}
              className="rounded-lg bg-cyan-500 px-3 py-1 text-xs font-semibold text-zinc-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Test Calibration
            </button>
          </div>
          {!allowUpload && !isLoading && (
            <p className="text-[11px] text-amber-300">Complete calibration before dropping your source file.</p>
          )}
        </div>

        <input 
            type="file" 
            ref={inputRef} 
            onChange={handleChange} 
            accept="audio/*" 
            className="hidden" 
        />
    </div>
  );
}

