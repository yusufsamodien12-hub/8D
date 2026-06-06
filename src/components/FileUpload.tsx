import React, { useRef } from 'react';
import { UploadCloud } from 'lucide-react';

interface FileUploadProps {
  onFileSelect: (file: File) => void;
  isLoading: boolean;
}

export function FileUpload({ onFileSelect, isLoading }: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('audio/')) {
      onFileSelect(file);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onFileSelect(file);
  };

  return (
    <div 
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      onClick={() => !isLoading && inputRef.current?.click()}
      className={`border-2 border-dashed rounded-xl p-12 flex flex-col items-center justify-center transition-all ${
        isLoading ? 'border-zinc-800 opacity-50 cursor-not-allowed' : 'border-zinc-700 hover:border-lime-400 hover:bg-zinc-900/50 cursor-pointer'
      }`}
    >
        <UploadCloud className={`w-12 h-12 mb-4 ${isLoading ? 'text-zinc-600 animate-pulse' : 'text-zinc-500'}`} />
        <h3 className="text-lg font-bold text-zinc-100 mb-2">
            {isLoading ? 'Analyzing Acoustic Properties...' : 'Upload Track for Analysis'}
        </h3>
        <p className="text-sm text-zinc-400 text-center max-w-md">
            {isLoading 
              ? 'Extracting BPM, generating spatial energy mapping envelope...' 
              : 'Drop an audio file here. The engine will automatically generate a dynamic 3D spatial path synced to tempo and amplitude metadata.'}
        </p>
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
