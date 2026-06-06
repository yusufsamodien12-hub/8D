import React, { useEffect, useRef } from 'react';
import { audioEngine } from '../lib/audio';

interface SpectrumVisualizerProps {
  isPlaying: boolean;
}

export function SpectrumVisualizer({ isPlaying }: SpectrumVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reqRef = useRef<number | null>(null);
  // analyser.fftSize is 256, frequencyBinCount is 128
  const dataArray = useRef(new Uint8Array(128));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let currentW = 0;
    let currentH = 0;

    const ro = new ResizeObserver((entries) => {
       for (const entry of entries) {
           const { width, height } = entry.contentRect;
           const dpr = window.devicePixelRatio || 1;
           if (width > 0 && height > 0) {
               canvas.width = width * dpr;
               canvas.height = height * dpr;
               ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
               currentW = width;
               currentH = height;
           }
       }
    });

    if (canvas.parentElement) {
       ro.observe(canvas.parentElement);
    }

    const loop = () => {
      if (!canvas || !ctx || currentW === 0 || currentH === 0) return;
      const W = currentW;
      const H = currentH;
      
      ctx.clearRect(0, 0, W, H);
      
      audioEngine.getFrequencyData(dataArray.current);
      
      const bars = Math.min(64, dataArray.current.length);
      const barWidth = W / bars;
      let barHeight;
      let x = 0;

      for (let i = 0; i < bars; i++) {
        const val = dataArray.current[i] ?? 0;
        barHeight = (val / 255) * H;
        
        // Color mapping from lime to yellow to red
        const hue = 80 - (val / 255) * 80; 
        
        const grad = ctx.createLinearGradient(0, H, 0, H - barHeight);
        grad.addColorStop(0, `hsla(${hue}, 80%, 50%, 0.8)`);
        grad.addColorStop(1, `hsla(${hue}, 80%, 65%, 1)`);

        ctx.fillStyle = grad;
        ctx.fillRect(x, H - barHeight, Math.max(1, barWidth - 1), barHeight);

        x += barWidth;
      }
      
      reqRef.current = requestAnimationFrame(loop);
    };

    reqRef.current = requestAnimationFrame(loop);

    return () => {
      if (reqRef.current) cancelAnimationFrame(reqRef.current);
      ro.disconnect();
    };
  }, [isPlaying]);

  return (
    <div className="w-full h-24 bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden relative">
      <div className="absolute top-2 left-3 text-xs font-mono text-zinc-500 font-bold uppercase tracking-wider z-10">Real-Time Spectrum</div>
      <canvas ref={canvasRef} className="w-full h-full" />
    </div>
  );
}
