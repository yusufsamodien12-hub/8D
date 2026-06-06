import React, { useEffect, useRef } from 'react';
import { SpatialNode, AudioAnalysisResult } from '../types';

interface AutomationTimelineProps {
  analysis: AudioAnalysisResult;
  currentTime: number;
  onSeek: (time: number) => void;
}

export function AutomationTimeline({ analysis, currentTime, onSeek }: AutomationTimelineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !analysis) return;
    
    // Ensure accurate resolution bounds
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    
    const W = rect.width;
    const H = rect.height;
    const { path, duration } = analysis;

    ctx.clearRect(0, 0, W, H);

    // 1. Draw "Waveform" (simulated background from energy profile)
    ctx.fillStyle = '#27272a'; // zinc-800
    const eLen = analysis.energyProfile.length;
    for (let i = 0; i < eLen; i++) {
        const x = (i / eLen) * W;
        const e = analysis.energyProfile[i];
        const barH = e * H * 0.8;
        ctx.fillRect(x, (H - barH)/2, W/eLen, barH);
    }

    // 2. Draw the automation path (Elevation/Energy)
    ctx.beginPath();
    ctx.strokeStyle = '#a3e635'; // lime-400
    ctx.lineWidth = 2;
    
    // A simplified visual path picking points
    const steps = 100;
    const points: {x:number, y:number}[] = [];
    for (let i=0; i<=steps; i++) {
        const time = (i/steps)*duration;
        const node = path.find(p => p.time >= time) || path[path.length - 1];
        if(!node) continue;
        
        const x = (time / duration) * W;
        // Map elevation to Y (higher elevation = higher on graph)
        const mappedY = H - (node.energy * H * 0.8) - (H*0.1); 
        points.push({x, y: mappedY});
        
        if (i===0) ctx.moveTo(x, mappedY);
        else ctx.lineTo(x, mappedY);
    }
    ctx.stroke();

    // Fill underneath area with light gradient
    const grad = ctx.createLinearGradient(0,0,0,H);
    grad.addColorStop(0, 'rgba(163, 230, 53, 0.4)');
    grad.addColorStop(1, 'rgba(163, 230, 53, 0.0)');
    ctx.lineTo(W, H);
    ctx.lineTo(0, H);
    ctx.fillStyle = grad;
    ctx.fill();

    // Draw nodes on peaks
    ctx.fillStyle = '#a3e635';
    for (let i = 0; i < points.length; i += 10) {
        ctx.beginPath();
        ctx.arc(points[i].x, points[i].y, 3.5, 0, Math.PI*2);
        ctx.fill();
    }

  }, [analysis, canvasRef.current?.getBoundingClientRect().width]);

  const handleInteraction = (e: React.MouseEvent<HTMLDivElement>) => {
     if (!wrapperRef.current) return;
     const rect = wrapperRef.current.getBoundingClientRect();
     const pct = (e.clientX - rect.left) / rect.width;
     onSeek(pct * analysis.duration);
  }

  // Calculate playhead % to style the playhead cursor div
  const progressPct = (currentTime / (analysis.duration || 1)) * 100;

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
        <div className="absolute bottom-2 left-3 text-xs font-mono text-zinc-500 font-bold tracking-widest uppercase">
            Automation Topology Envelope
        </div>
    </div>
  );
}
