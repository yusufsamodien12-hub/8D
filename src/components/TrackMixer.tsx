import React from 'react';
import { Track } from '../types';
import { Volume2, VolumeX, Headphones, Trash2, Box } from 'lucide-react';

interface TrackMixerProps {
  tracks: Track[];
  onUpdateTrack: (id: string, updates: Partial<Track>) => void;
  onRemoveTrack: (id: string) => void;
  reverbLevel: number;
  onReverbLevelChange: (level: number) => void;
}

const colors: Record<string, string> = {
  vocals: 'bg-pink-500',
  drums: 'bg-orange-400',
  bass: 'bg-red-500',
  other: 'bg-lime-400'
};

export function TrackMixer({ tracks, onUpdateTrack, onRemoveTrack, reverbLevel, onReverbLevelChange }: TrackMixerProps) {
  if (tracks.length === 0) return null;

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden flex flex-col h-full">
       <div className="p-4 border-b border-zinc-800 bg-zinc-950/20">
          <h3 className="text-xs font-mono font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-2">
            <Volume2 size={14} /> Matrix Mixer
          </h3>
       </div>

       {/* Global 3D Reverb Control */}
       <div className="p-4 border-b border-zinc-800/50 bg-zinc-900/50">
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-mono font-bold tracking-widest text-zinc-400 flex items-center gap-2">
              <Box size={14} className="text-cyan-400" />
              GLOBAL 3D REVERB
            </label>
            <span className="text-xs font-mono text-cyan-400 bg-cyan-400/10 px-2 py-0.5 rounded">
              {Math.round(reverbLevel * 100)}%
            </span>
          </div>
          <div className="flex items-center gap-2">
             <VolumeX size={12} className="text-zinc-600" />
             <input 
               type="range" 
               min="0" 
               max="1.0" 
               step="0.01" 
               value={reverbLevel} 
               onChange={(e) => onReverbLevelChange(parseFloat(e.target.value))}
               className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
             />
             <Volume2 size={12} className="text-cyan-600" />
          </div>
       </div>

       <div className="p-4 space-y-4 overflow-y-auto max-h-[450px]">
          {tracks.map(track => (
            <div key={track.id} className="bg-zinc-950/50 rounded-lg p-3 border border-zinc-800/50 space-y-3">
               
               <div className="flex items-center justify-between">
                 <div className="flex items-center gap-2 overflow-hidden mr-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${colors[track.type] || colors.other} flex-shrink-0`} />
                    <span className="text-sm font-semibold truncate text-zinc-200">{track.name}</span>
                 </div>
                 <button onClick={() => onRemoveTrack(track.id)} className="text-zinc-500 hover:text-red-400 transition-colors">
                   <Trash2 size={14} />
                 </button>
               </div>
               
               <div className="flex items-center gap-3">
                  <div className="flex gap-1 flex-shrink-0">
                     <button 
                       onClick={() => onUpdateTrack(track.id, { isMuted: !track.isMuted })}
                       className={`w-8 h-7 text-[10px] font-bold rounded flex items-center justify-center transition-colors ${track.isMuted ? 'bg-red-500/20 text-red-500 border border-red-500/30' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}
                     >
                        M
                     </button>
                     <button 
                       onClick={() => onUpdateTrack(track.id, { isSoloed: !track.isSoloed })}
                       className={`w-8 h-7 text-[10px] font-bold rounded flex items-center justify-center transition-colors ${track.isSoloed ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}
                     >
                        S
                     </button>
                  </div>
                  <div className="flex-1 flex items-center gap-2">
                     <VolumeX size={12} className="text-zinc-600" />
                     <input 
                       type="range" 
                       min="0" 
                       max="1.5" 
                       step="0.01" 
                       value={track.volume} 
                       onChange={(e) => onUpdateTrack(track.id, { volume: parseFloat(e.target.value) })}
                       className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-lime-400"
                     />
                     <Volume2 size={12} className="text-zinc-600" />
                  </div>
               </div>
               
               <div className="flex items-center justify-between text-[9px] font-mono text-zinc-500 uppercase tracking-widest pt-1 border-t border-zinc-800/50">
                  <span>{track.type} Path</span>
                  <span className={track.type === 'bass' ? 'text-zinc-600' : 'text-lime-500/70'}>
                    {track.type === 'bass' ? 'Static (0.2r)' : 'Dynamic 3D'}
                  </span>
               </div>
            </div>
          ))}
       </div>
    </div>
  );
}
