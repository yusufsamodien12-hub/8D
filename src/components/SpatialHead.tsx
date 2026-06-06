import React, { useEffect, useRef } from 'react';
import { SpatialNode, AudioAnalysisResult } from '../types';

interface SpatialHeadProps {
  analysis: AudioAnalysisResult;
  currentTime: number;
}

export function SpatialHead({ analysis, currentTime }: SpatialHeadProps) {
  const topRef = useRef<HTMLCanvasElement>(null);
  const sideRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const node = analysis.path.find(p => p.time >= currentTime) || analysis.path[analysis.path.length - 1];
    if (!node) return;

    renderTopView(node);
    renderSideView(node);
  }, [currentTime, analysis]);

  const renderTopView = (node: SpatialNode) => {
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
    ctx.fillStyle = '#3f3f46'; // zinc-700
    ctx.beginPath();
    ctx.arc(cx, cy, 25, 0, Math.PI * 2);
    ctx.fill();
    // Nose pointer
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

    // Determine 2D Pos: x is Left/Right (- to +). Z is Front/back. (-Z is front)
    // Canvas: Y up is -, Y down is +. WebAudio Z: - is Front. So map Z to Y.
    const radiusVisual = 25 + (node.radius * 25) * 1.5;
    const pos_x = cx + Math.sin(node.angle) * radiusVisual;
    const pos_y = cy - Math.cos(node.angle) * radiusVisual; // - is front. angle 0 = front

    // Draw active path trail
    ctx.strokeStyle = 'rgba(163, 230, 53, 0.3)'; // lime 
    ctx.lineWidth = 3;
    ctx.beginPath();
    let drawn = false;
    for(let i=0; i<30; i++) {
        const t = Math.max(0, node.time - (i*0.1));
        const pastNode = analysis.path.find(p=>p.time>=t);
        if(!pastNode) continue;
        
        const pr = 25 + (pastNode.radius * 25) * 1.5;
        const px = cx + Math.sin(pastNode.angle) * pr;
        const py = cy - Math.cos(pastNode.angle) * pr;
        if (!drawn) { ctx.moveTo(px, py); drawn=true; }
        else { ctx.lineTo(px, py); }
    }
    ctx.stroke();

    // Source Dot
    const pulse = 1 + (node.energy * 0.5);
    ctx.beginPath();
    ctx.arc(pos_x, pos_y, 6 * pulse, 0, Math.PI*2);
    ctx.fillStyle = `rgba(163, 230, 53, ${0.8 + (node.energy * 0.2)})`;
    ctx.fill();
    ctx.shadowBlur = Math.max(5, node.energy * 20);
    ctx.shadowColor = '#a3e635';
    ctx.fill();
    ctx.shadowBlur = 0; // reset
  };

  const renderSideView = (node: SpatialNode) => {
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

    // Draw Head Profile Silhouette
    ctx.fillStyle = '#3f3f46';
    ctx.beginPath();
    ctx.ellipse(cx, cy, 22, 28, 0, 0, Math.PI*2);
    ctx.fill();
    // Nose facing right
    ctx.beginPath();
    ctx.moveTo(cx + 15, cy - 5);
    ctx.lineTo(cx + 30, cy + 5);
    ctx.lineTo(cx + 15, cy + 15);
    ctx.fill();

    // The rings from Image 2
    // Ear-level (0 deg), Height Layer (30 deg), Top Layer (90 deg)
    const drawRingLayer = (color: string, yOffset: number, scaleX: number, label: string) => {
       ctx.strokeStyle = color;
       ctx.lineWidth = 1.5;
       ctx.beginPath();
       ctx.ellipse(cx, cy - yOffset, 60 * scaleX, 15, 0, Math.PI, 0); // only draw front arc or full? full
       ctx.stroke();
       ctx.beginPath();
       ctx.strokeStyle = color.replace('1)', '0.2)');
       ctx.ellipse(cx, cy - yOffset, 60 * scaleX, 15, 0, 0, Math.PI);
       ctx.stroke();

       // Label
       ctx.fillStyle = color;
       ctx.font = '8px monospace';
       ctx.fillText(label, cx + (65 * scaleX), cy - yOffset + 3);
    }

    drawRingLayer('rgba(56, 189, 248, 1)', 0, 1.0, 'EAR-LEVEL'); // blue-400
    drawRingLayer('rgba(250, 204, 21, 1)', 35, 0.8, 'HEIGHT (30°)'); // yellow-400
    drawRingLayer('rgba(239, 68, 68, 1)', 70, 0.4, 'TOP (90°)');     // red-500

    // Source Dot in Side view
    // X = Front/Back (node.z, but since nose is right, +Z is back = left on canvas)
    // Y = Elevation
    // This is tricky mapping. 
    // Radius visual affects distance
    const rBase = 60 * (1 + (node.radius-1)*0.5); 
    const elRatio = node.elevationAngle / (Math.PI/2); // 0 to 1 mapping 0 to 90 deg
    
    // Using simple polar from center of head for side view
    // Angle: 0 is right (front), PI/2 is up.
    // wait, Z in WebAudio is -Z is front. 
    // angle=0 is front (-z), angle=PI is back (+z). 
    const depthScale = Math.cos(node.angle); // 1 = back, -1 = front
    const frontBackShift = -depthScale * rBase; 

    const px = cx + frontBackShift;
    const py = cy - Math.sin(node.elevationAngle) * 75; // 75 pixel max height

    const dotPulse = 1 + node.energy * 0.5;
    ctx.beginPath();
    ctx.arc(px, py, 6 * dotPulse, 0, Math.PI*2);
    ctx.fillStyle = `rgba(255, 255, 255, 0.9)`;
    ctx.fill();
    ctx.shadowBlur = 10;
    ctx.shadowColor = '#fff';
    ctx.fill();
    ctx.shadowBlur = 0;
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      
      {/* Top View */}
      <div className="relative w-full aspect-square md:aspect-video rounded-lg bg-zinc-900 border border-zinc-800 flex flex-col pt-3">
         <div className="absolute top-3 left-3 text-xs font-mono text-zinc-500 font-bold uppercase tracking-wider z-10">Azimuth Plane (Top)</div>
         <canvas ref={topRef} className="w-full flex-1" />
         <div className="absolute bottom-3 w-full text-center text-[10px] text-zinc-600 font-mono font-black tracking-[0.2em]">BACK</div>
         <div className="absolute top-3 w-full text-center text-[10px] text-zinc-500 font-mono font-black tracking-[0.2em]">FRONT</div>
      </div>

      {/* Side View */}
      <div className="relative w-full aspect-square md:aspect-video rounded-lg bg-zinc-900 border border-zinc-800 flex flex-col pt-3">
         <div className="absolute top-3 left-3 text-xs font-mono text-zinc-500 font-bold uppercase tracking-wider z-10">Elevation Plane (Side)</div>
         <canvas ref={sideRef} className="w-full flex-1" />
      </div>

    </div>
  );
}
