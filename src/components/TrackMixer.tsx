import React, { useRef, useEffect } from 'react';
import { Track, HeadphoneProfile } from '../types';
import { Volume2, VolumeX, Headphones, Trash2, Box, SlidersHorizontal, Activity } from 'lucide-react';

interface TrackMixerProps {
  tracks: Track[];
  currentTime: number;
  onUpdateTrack: (id: string, updates: Partial<Track>) => void;
  onRemoveTrack: (id: string) => void;
  reverbLevel: number;
  onReverbLevelChange: (level: number) => void;
  profile: HeadphoneProfile;
  onProfileChange: (p: HeadphoneProfile) => void;
}

const colors: Record<string, string> = {
  vocals: 'bg-pink-500',
  drums: 'bg-orange-400',
  bass: 'bg-red-500',
  other: 'bg-lime-400'
};

const hexColors: Record<string, string> = {
  vocals: '#ec4899',
  drums: '#fb923c',
  bass: '#ef4444',
  other: '#a3e635'
};

function TrackMiniRadar({ track, currentTime }: { track: Track; currentTime: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Support higher DPI rendering
    const dpr = window.devicePixelRatio || 1;
    const size = 36;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;

    const center = size / 2;

    ctx.clearRect(0, 0, size, size);
    
    // Background and crosshair
    ctx.strokeStyle = '#27272a'; // zinc-800
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(center, 0); ctx.lineTo(center, size);
    ctx.moveTo(0, center); ctx.lineTo(size, center);
    ctx.stroke();

    ctx.strokeStyle = '#3f3f46'; // zinc-700
    ctx.beginPath();
    ctx.arc(center, center, center - 2, 0, Math.PI * 2);
    ctx.stroke();

    const node = track.analysis.path.find(p => p.time >= currentTime) || track.analysis.path[track.analysis.path.length-1];
    if (!node) return;

    // Draw historical path tail
    const historicalNodes = track.analysis.path.filter(p => p.time >= currentTime - 1 && p.time <= currentTime);
    if (historicalNodes.length > 1) {
      ctx.beginPath();
      historicalNodes.forEach((hn, i) => {
         const hr = (center - 2) * Math.min(1.0, (hn.radius / 1.5));
         const hx = center + Math.sin(hn.angle) * hr;
         const hy = center - Math.cos(hn.angle) * hr;
         if (i === 0) ctx.moveTo(hx, hy);
         else ctx.lineTo(hx, hy);
      });
      ctx.strokeStyle = `${hexColors[track.type] || hexColors.other}66`; // 40% opacity tail
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Current position
    const r = (center - 2) * Math.min(1.0, (node.radius / 1.5));
    const px = center + Math.sin(node.angle) * r;
    const py = center - Math.cos(node.angle) * r;

    ctx.fillStyle = hexColors[track.type] || hexColors.other;
    ctx.beginPath();
    ctx.arc(px, py, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // Volume level circle pulsing
    ctx.beginPath();
    ctx.arc(px, py, 2.5 + (node.dynamicVolume * 3), 0, Math.PI * 2);
    ctx.fillStyle = `${hexColors[track.type] || hexColors.other}40`;
    ctx.fill();

  }, [currentTime, track]);

  return (
    <div className="relative">
      <canvas ref={canvasRef} className="rounded-full bg-zinc-950 block border border-zinc-800" />
      <div className="absolute inset-0 flex items-center justify-center mix-blend-screen pointer-events-none opacity-20">
         <Headphones size={12} className="text-zinc-500" />
      </div>
    </div>
  );
}

function TrackVolumeMonitor({ track, currentTime, onVolumeChange }: { track: Track; currentTime: number; onVolumeChange: (vol: number) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  const node = track.analysis.path.find(p => p.time >= currentTime) || track.analysis.path[track.analysis.path.length-1];
  const dynamicMultiplier = node ? node.dynamicVolume : 1.0;
  
  const visualVolume = Math.min(1.5, track.volume * dynamicMultiplier);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Support higher DPI rendering
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.parentElement?.clientWidth || 300;
    const height = 32;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);
    canvas.style.width = '100%';
    canvas.style.height = `${height}px`;

    ctx.clearRect(0, 0, width, height);

    const lookAheadWindow = 5.0; // seconds
    const path = track.analysis.path;

    // Draw baseline
    ctx.strokeStyle = '#27272a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, height); ctx.lineTo(width, height);
    ctx.stroke();

    ctx.beginPath();
    let started = false;
    
    const timePerNode = 0.05;
    for (let i = 0; i < width; i++) {
       const t = currentTime + (i / width) * lookAheadWindow;
       const index = Math.floor(t / timePerNode);
       const nodeData = path[index];
       if (!nodeData) continue;

       const vol = Math.min(1.5, track.volume * nodeData.dynamicVolume);
       const x = i;
       const y = height - (vol / 1.5) * height;

       if (!started) {
          ctx.moveTo(x, y);
          started = true;
       } else {
          ctx.lineTo(x, y);
       }
    }

    ctx.strokeStyle = `${hexColors[track.type] || hexColors.other}60`;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.fillStyle = `${hexColors[track.type] || hexColors.other}10`;
    ctx.fill();

  }, [currentTime, track, track.volume]);

  return (
    <div className={`flex-1 relative h-8 rounded bg-zinc-950/80 border border-zinc-800/80 overflow-hidden flex items-center ${track.isMuted ? 'opacity-50' : ''}`}>
       <div className="absolute inset-0">
          <canvas ref={canvasRef} className="block w-full h-full" />
       </div>
       
       <div className="absolute inset-0 flex items-center justify-center opacity-[0.03] pointer-events-none">
          <Activity size={24} className="text-zinc-100" />
       </div>

       <input 
          type="range" 
          min="0" 
          max="1.5" 
          step="0.01" 
          value={track.volume} 
          onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
       />

       <div 
          className="absolute top-0 bottom-0 pointer-events-none border-r-2 bg-gradient-to-r from-transparent to-white/10"
          style={{ 
             width: `${(visualVolume / 1.5) * 100}%`,
             borderColor: hexColors[track.type] || hexColors.other
          }}
       >
          <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 w-2 h-6 bg-white rounded-sm shadow-[0_0_10px_rgba(255,255,255,0.8)]" />
       </div>
    </div>
  );
}

export function TrackMixer({ tracks, currentTime, onUpdateTrack, onRemoveTrack, reverbLevel, onReverbLevelChange, profile, onProfileChange }: TrackMixerProps) {
  if (tracks.length === 0) return null;

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden flex flex-col h-full">
       <div className="p-4 border-b border-zinc-800 bg-zinc-950/20">
          <h3 className="text-xs font-mono font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-2">
            <Volume2 size={14} /> Matrix Mixer
          </h3>
       </div>

       {/* Global 3D Reverb & HRTF Control */}
       <div className="p-4 border-b border-zinc-800/50 bg-zinc-900/50 space-y-4">
          <div>
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

          <div>
             <div className="flex items-center justify-between mb-2">
               <label className="text-xs font-mono font-bold tracking-widest text-zinc-400 flex items-center gap-2">
                 <SlidersHorizontal size={14} className="text-purple-400" />
                 HRTF PROFILE
               </label>
             </div>
             <select 
               value={profile} 
               onChange={(e) => onProfileChange(e.target.value as HeadphoneProfile)}
               className="w-full bg-zinc-950 border border-zinc-800 text-zinc-300 text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-purple-500"
             >
               <option value="flat">Studio Flat (Default Binaural)</option>
               <option value="bass_boost">Bass Heavy (Closed-Back)</option>
               <option value="open_back">Airy Width (Open-Back)</option>
               <option value="stereo">Standard Stereo (Speakers)</option>
             </select>
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
                  <TrackMiniRadar track={track} currentTime={currentTime} />
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
                     <TrackVolumeMonitor track={track} currentTime={currentTime} onVolumeChange={(vol) => onUpdateTrack(track.id, { volume: vol })} />
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
