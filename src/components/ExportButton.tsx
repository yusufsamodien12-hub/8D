import React, { useState } from 'react';
import { Track } from '../types';
import exportMixToWav, { exportMixToMp3 } from '../lib/export';
import { Download } from 'lucide-react';

type ExportFormat = 'wav' | 'mp3';

export function ExportButton({ tracks }: { tracks: Track[] }) {
  const [isExporting, setIsExporting] = useState(false);
  const [format, setFormat] = useState<ExportFormat>('mp3');

  const handleExport = async () => {
    if (tracks.length === 0) return;

    try {
      setIsExporting(true);
      const blob = format === 'mp3'
        ? await exportMixToMp3(tracks)
        : await exportMixToWav(tracks);

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `mix_${Date.now()}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Export failed', e);
      alert('Export failed: ' + (e as Error).message);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <select
        value={format}
        onChange={(e) => setFormat(e.target.value as ExportFormat)}
        className="bg-zinc-950 border border-zinc-800 text-zinc-300 text-xs rounded-lg px-2 py-1 focus:outline-none focus:border-lime-400"
      >
        <option value="mp3">MP3 (192kbps)</option>
        <option value="wav">WAV</option>
      </select>
      <button
        onClick={handleExport}
        disabled={isExporting || tracks.length === 0}
        className="w-12 h-12 flex items-center justify-center rounded-full hover:bg-zinc-800 text-zinc-400 transition-colors"
        title={`Export Mix (${format.toUpperCase()})`}
      >
        {isExporting ? <span className="text-xs font-mono">Exporting...</span> : <Download size={16} />}
      </button>
    </div>
  );
}

export default ExportButton;
