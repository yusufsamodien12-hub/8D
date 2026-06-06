import React, { useEffect, useRef } from 'react';
import { Track } from '../types';

interface SpatialHeadProps {
  tracks: Track[];
  currentTime: number;
}

const colors = {
  vocals: '#ec4899', // pink-500
  drums: '#fb923c',  // orange-400
  bass: '#ef4444',   // red-500
  other: '#a3e635'   // lime-400
};

export function SpatialHead({ tracks, currentTime }: SpatialHeadProps) {
  const topRef = useRef<HTMLCanvasElement>(null);
  const sideRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    renderTopView();
    renderSideView();
  }, [currentTime, tracks]);

  const getActiveTracks = () => {
    const hasSolo = tracks.some(t => t.isSoloed);
    return tracks.filter(t => !t.isMuted && (!hasSolo || t.isSoloed));
  };

  const renderTopView = () => {
    const canvas = topRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if(canvas.width !== rect.width * dpr) {
       canvas.width = rect.width * dpr;
       canvas.height = rect.height * dpr;
       ctx.scale(dpr, dpr);
    }
    const W = rect.width;
    const H = rect.height;
    const cx = W / 2;
    const cy = H / 2;

    ctx.clearRect(0,0,W,H);

    // Draw Head
    ctx.fillStyle = '#3f3f46';
    ctx.beginPath();
    ctx.arc(cx, cy, 25, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx - 5, cy - 20);
    ctx.lineTo(cx + 5, cy - 20);
    ctx.lineTo(cx, cy - 35);
    ctx.fill();
    
    // Draw guide rings
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    for(let r=1; r<=3; r++){
       ctx.beginPath();
       ctx.arc(cx, cy, 25 + (r * 25), 0, Math.PI*2);
       ctx.stroke();
    }

    const activeTracks = getActiveTracks();
    
    activeTracks.forEach(track => {
      const node = track.analysis.path.find(p => p.time >= currentTime) || track.analysis.path[track.analysis.path.length - 1];
      if (!node) return;

      const radiusVisual = 25 + (node.radius * 25) * 1.5;
      const pos_x = cx + Math.sin(node.angle) * radiusVisual;
      const pos_y = cy - Math.cos(node.angle) * radiusVisual;
      const color = colors[track.type] || colors.other;

      // Draw active path trail
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.3;
      ctx.lineWidth = 2;
      ctx.beginPath();
      let drawn = false;
      for(let i=0; i<20; i++) {
          const t = Math.max(0, node.time - (i*0.1));
          const pastNode = track.analysis.path.find(p=>p.time>=t);
          if(!pastNode) continue;
          
          const pr = 25 + (pastNode.radius * 25) * 1.5;
          const px = cx + Math.sin(pastNode.angle) * pr;
          const py = cy - Math.cos(pastNode.angle) * pr;
          if (!drawn) { ctx.moveTo(px, py); drawn=true; }
          else { ctx.lineTo(px, py); }
      }
      ctx.stroke();
      ctx.globalAlpha = 1.0;

      // Source Dot
      const pulse = 1 + (node.energy * 0.5);
      ctx.beginPath();
      ctx.arc(pos_x, pos_y, 5 * pulse, 0, Math.PI*2);
      ctx.fillStyle = color;
      ctx.shadowBlur = Math.max(5, node.energy * 15);
      ctx.shadowColor = color;
      ctx.fill();
      ctx.shadowBlur = 0; 
      
      // Label
      ctx.fillStyle = '#fff';
      ctx.font = '9px sans-serif';
      ctx.fillText(track.type, pos_x + 8, pos_y + 3);
    });
  };

  const renderSideView = () => {
    const canvas = sideRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (canvas.width !== rect.width * dpr) {
       canvas.width = rect.width * dpr;
       canvas.height = rect.height * dpr;
       ctx.scale(dpr, dpr);
    }
    const W = rect.width;
    const H = rect.height;
    const cx = W / 2;
    const cy = H / 2 + 20;

    ctx.clearRect(0,0,W,H);

    ctx.fillStyle = '#3f3f46';
    ctx.beginPath();
    ctx.ellipse(cx, cy, 22, 28, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx + 15, cy - 5);
    ctx.lineTo(cx + 30, cy + 5);
    ctx.lineTo(cx + 15, cy + 15);
    ctx.fill();

    const drawRingLayer = (colorStr: string, yOffset: number, scaleX: number, label: string) => {
       ctx.strokeStyle = colorStr;
       ctx.lineWidth = 1.5;
       ctx.beginPath();
       ctx.ellipse(cx, cy - yOffset, 60 * scaleX, 15, 0, Math.PI, 0); 
       ctx.stroke();
       ctx.beginPath();
       ctx.strokeStyle = colorStr.replace('1)', '0.2)');
       ctx.ellipse(cx, cy - yOffset, 60 * scaleX, 15, 0, 0, Math.PI);
       ctx.stroke();
       ctx.fillStyle = colorStr;
       ctx.font = '8px monospace';
       ctx.fillText(label, cx + (65 * scaleX), cy - yOffset + 3);
    }

    drawRingLayer('rgba(56, 189, 248, 1)', 0, 1.0, 'EAR-LEVEL'); 
    drawRingLayer('rgba(250, 204, 21, 1)', 35, 0.8, 'HEIGHT (30°)'); 
    drawRingLayer('rgba(239, 68, 68, 1)', 70, 0.4, 'TOP (90°)');     

    const activeTracks = getActiveTracks();
    
    activeTracks.forEach(track => {
      const node = track.analysis.path.find(p => p.time >= currentTime) || track.analysis.path[track.analysis.path.length - 1];
      if (!node) return;

      const rBase = 60 * (1 + (node.radius-1)*0.5); 
      const depthScale = Math.cos(node.angle); // 1 = back, -1 = front
      const frontBackShift = -depthScale * rBase; 

      const px = cx + frontBackShift;
      const py = cy - Math.sin(node.elevationAngle) * 75; 

      const dotPulse = 1 + node.energy * 0.3;
      const color = colors[track.type] || colors.other;
      
      ctx.beginPath();
      ctx.arc(px, py, 5 * dotPulse, 0, Math.PI*2);
      ctx.fillStyle = color;
      ctx.shadowBlur = 10;
      ctx.shadowColor = color;
      ctx.fill();
      ctx.shadowBlur = 0;
    });
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <div className="relative w-full aspect-square md:aspect-video rounded-lg bg-zinc-900 border border-zinc-800 flex flex-col pt-3">
         <div className="absolute top-3 left-3 text-[10px] font-mono text-zinc-500 font-bold uppercase tracking-wider z-10">Azimuth Plane (Top)</div>
         <canvas ref={topRef} className="w-full h-full flex-1" />
         <div className="absolute bottom-3 w-full text-center text-[10px] text-zinc-600 font-mono font-black tracking-[0.2em]">BACK</div>
         <div className="absolute top-3 w-full text-center text-[10px] text-zinc-500 font-mono font-black tracking-[0.2em]">FRONT</div>
      </div>

      <div className="relative w-full aspect-square md:aspect-video rounded-lg bg-zinc-900 border border-zinc-800 flex flex-col pt-3">
         <div className="absolute top-3 left-3 text-[10px] font-mono text-zinc-500 font-bold uppercase tracking-wider z-10">Elevation Plane (Side)</div>
         <canvas ref={sideRef} className="w-full h-full flex-1" />
      </div>
    </div>
  );
}
