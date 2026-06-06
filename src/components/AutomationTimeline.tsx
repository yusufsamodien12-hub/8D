import React, { useRef, useEffect } from 'react';
import { Track } from '../types';

interface AutomationTimelineProps {
  tracks: Track[];
  currentTime: number;
  duration: number;
  onSeek: (time: number) => void;
}

const colors = {
  vocals: '#ec4899', // pink-500
  drums: '#fb923c',  // orange-400
  bass: '#ef4444',   // red-500
  other: '#a3e635'   // lime-400
};

export function AutomationTimeline({ tracks, currentTime, duration, onSeek }: AutomationTimelineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || tracks.length === 0) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    let currentW = canvas.clientWidth;
    let currentH = canvas.clientHeight;

    const draw = () => {
        if (!currentW || !currentH) return;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = currentW * dpr;
        canvas.height = currentH * dpr;
        ctx.scale(dpr, dpr);
        
        ctx.clearRect(0, 0, currentW, currentH);
        const activeTracks = tracks.filter(t => !t.isMuted);
        const hasSolo = activeTracks.some(t => t.isSoloed);

        activeTracks.forEach(track => {
           if (hasSolo && !track.isSoloed) return;

           ctx.beginPath();
           ctx.strokeStyle = colors[track.type] || colors.other;
           ctx.lineWidth = 1.5;
           
           const path = track.analysis.path;
           const steps = 150;
           
           for (let i=0; i<=steps; i++) {
               const time = (i/steps) * duration;
               const node = path.find(p => p.time >= time) || path[path.length - 1];
               if(!node) continue;
               
               const x = (time / duration) * currentW;
               const mappedY = currentH - (node.energy * currentH * 0.5) - (node.elevationAngle * 20) - (currentH*0.1); 
               
               if (i===0) ctx.moveTo(x, mappedY);
               else ctx.lineTo(x, mappedY);
           }
           ctx.stroke();
        });
    };

    const ro = new ResizeObserver((entries) => {
       for (const entry of entries) {
           currentW = entry.contentRect.width;
           currentH = entry.contentRect.height;
           draw();
       }
    });

    if (wrapperRef.current) {
        ro.observe(wrapperRef.current);
    }
    
    draw();

    return () => ro.disconnect();

  }, [tracks, duration]);

  const handleInteraction = (e: React.MouseEvent<HTMLDivElement>) => {
     if (!wrapperRef.current) return;
     const rect = wrapperRef.current.getBoundingClientRect();
     const pct = (e.clientX - rect.left) / rect.width;
     onSeek(pct * duration);
  }

  const progressPct = (currentTime / (duration || 1)) * 100;

  return (
    <div 
      className="relative w-full h-32 rounded-lg bg-zinc-900 border border-zinc-800 overflow-hidden cursor-pointer"
      ref={wrapperRef}
      onMouseDown={handleInteraction}
      onMouseMove={(e) => { if(e.buttons === 1) handleInteraction(e); }}
    >
        <canvas 
          ref={canvasRef} 
          className="absolute inset-0 w-full h-full pointer-events-none"
        />
        <div 
          className="absolute top-0 bottom-0 w-0.5 bg-zinc-100 drop-shadow-[0_0_8px_rgba(255,255,255,0.8)] z-10 pointer-events-none"
          style={{ left: `${Math.min(100, progressPct)}%` }}
        />
        <div className="absolute bottom-2 left-3 text-[10px] font-mono text-zinc-500 font-bold tracking-widest uppercase flex gap-3">
            <span>Automation Network</span>
            {tracks.map(t => (
               <div key={t.id} className="flex items-center gap-1">
                 <span className="w-2 h-2 rounded-full" style={{ backgroundColor: colors[t.type] || colors.other }} />
                 <span>{t.type}</span>
               </div>
            ))}
        </div>
    </div>
  );
}
