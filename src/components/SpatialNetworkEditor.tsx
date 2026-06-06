import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Track, SpatialNode } from '../types';

interface SpatialNetworkEditorProps {
  tracks: Track[];
  currentTime: number;
  onUpdateTrackPath: (trackId: string, path: SpatialNode[]) => void;
}

type PathMode = 'orbit' | 'figure8' | 'rise' | 'fixed';
type HRTFMode = 'kemar' | 'listen' | 'cipic' | 'sadie';
type RoomPreset = 'studioA' | 'concert' | 'chamber' | 'cathedral' | 'anechoic';

const stemColors: Record<string, string> = {
  sub_bass: '#22ee88',
  bass: '#22ee88',
  kick: '#ff5522',
  snare: '#ff8844',
  hi_hats: '#ffaa55',
  vocals: '#aa77ff',
  vocals_male: '#cc88ff',
  vocals_female: '#dd99ff',
  lead: '#ff4488',
  strings: '#33ccff',
  brass: '#ffdd33',
  guitar: '#ffdd33',
  piano: '#55ffee',
  pad: '#33ccff',
  synth: '#55ffee',
  ambient: '#66bbff',
  other: '#9090ff'
};

const roomPresets: Record<RoomPreset, Record<string, number>> = {
  studioA: { w: 12, l: 18, h: 4, pre: 18, rt60: 12, diff: 65, wet: 35, floor: 40, walls: 55, ceil: 70 },
  concert: { w: 40, l: 80, h: 20, pre: 35, rt60: 28, diff: 80, wet: 55, floor: 20, walls: 30, ceil: 40 },
  chamber: { w: 8, l: 12, h: 5, pre: 12, rt60: 16, diff: 50, wet: 40, floor: 60, walls: 70, ceil: 75 },
  cathedral: { w: 30, l: 100, h: 40, pre: 60, rt60: 90, diff: 90, wet: 70, floor: 10, walls: 20, ceil: 15 },
  anechoic: { w: 6, l: 6, h: 4, pre: 0, rt60: 1, diff: 10, wet: 0, floor: 99, walls: 99, ceil: 99 }
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const deriveStemParams = (track: Track) => {
  const first = track.analysis.path[0] || ({ x: 0, y: 0, z: -1, dynamicVolume: track.volume } as SpatialNode);
  const dist = Math.sqrt(first.x * first.x + first.y * first.y + first.z * first.z) || 1;
  const az = Math.atan2(first.x, -first.z) * (180 / Math.PI);
  const el = Math.asin(clamp(first.y / dist, -1, 1)) * (180 / Math.PI);

  return {
    az: Number(az.toFixed(0)),
    el: Number(el.toFixed(0)),
    dist: Number((dist * 10).toFixed(0)),
    width: 30,
    r: Number(clamp((dist / 2.5) * 100, 5, 100).toFixed(0)),
    sp: 5,
    ew: 15,
    vol: Number(track.volume.toFixed(2)),
    path: 'orbit' as PathMode
  };
};

const areParamSetsEqual = (a: ReturnType<typeof deriveStemParams>, b: ReturnType<typeof deriveStemParams>) =>
  a.az === b.az &&
  a.el === b.el &&
  a.dist === b.dist &&
  a.width === b.width &&
  a.r === b.r &&
  a.sp === b.sp &&
  a.ew === b.ew &&
  a.vol === b.vol &&
  a.path === b.path;

const arePathsEqual = (a: SpatialNode[], b: SpatialNode[]) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const na = a[i];
    const nb = b[i];
    if (
      na.time !== nb.time ||
      na.x !== nb.x ||
      na.y !== nb.y ||
      na.z !== nb.z ||
      na.dynamicVolume !== nb.dynamicVolume ||
      na.radius !== nb.radius ||
      na.angle !== nb.angle ||
      na.elevationAngle !== nb.elevationAngle ||
      na.orbitType !== nb.orbitType ||
      na.spinRate !== nb.spinRate
    ) {
      return false;
    }
  }
  return true;
};

const buildPathFromParams = (params: ReturnType<typeof deriveStemParams>, duration: number) => {
  const nodes: SpatialNode[] = [];
  const steps = Math.max(32, Math.round(duration * 4));
  const baseAz = params.az;
  const baseEl = params.el;
  const radius = clamp(params.r / 100, 0.2, 1.0) * 2.5;

  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * duration;
    const phase = (i / steps) * Math.PI * 2;
    let az = baseAz;
    let el = baseEl;

    if (params.path === 'orbit') {
      az = baseAz + phase * (params.sp / 10);
      el = baseEl + Math.sin(phase + params.ew * 0.04) * params.ew * 0.25;
    } else if (params.path === 'figure8') {
      az = baseAz + Math.sin(phase) * params.sp * 0.8;
      el = baseEl + Math.sin(phase * 2) * params.ew * 0.35;
    } else if (params.path === 'rise') {
      az = baseAz + Math.cos(phase) * params.sp * 0.15;
      el = baseEl + (t / duration - 0.5) * params.ew;
    }

    const azR = az * (Math.PI / 180);
    const elR = el * (Math.PI / 180);
    const x = Math.cos(elR) * Math.sin(azR) * radius;
    const y = Math.sin(elR) * radius;
    const z = -Math.cos(elR) * Math.cos(azR) * radius;
    const energy = 0.3 + Math.abs(Math.sin(phase)) * 0.4;

    nodes.push({
      time: t,
      x,
      y,
      z,
      energy,
      angle: azR,
      radius,
      elevationAngle: elR,
      dynamicVolume: clamp(params.vol * (0.45 + 0.55 * Math.abs(Math.cos(phase))), 0.1, 1.8),
      lowEnergy: 0,
      highEnergy: 0,
      orbitType:
        params.path === 'fixed' ? 'static' : params.path === 'orbit' ? 'circular' : params.path === 'rise' ? 'spiral' : 'figure8',
      spinRate: params.sp * 0.1
    });
  }

  return nodes;
};

export function SpatialNetworkEditor({ tracks, currentTime, onUpdateTrackPath }: SpatialNetworkEditorProps) {
  const [selectedId, setSelectedId] = useState<string>(tracks[0]?.id || '');
  const [playing, setPlaying] = useState(false);
  const [looping, setLooping] = useState(true);
  const [viewMode, setViewMode] = useState<'persp' | 'top' | 'front' | 'side'>('persp');
  const [pathMode, setPathMode] = useState<PathMode>('orbit');
  const [hrtfMode, setHrtfMode] = useState<HRTFMode>('kemar');
  const [roomPreset, setRoomPreset] = useState<RoomPreset>('studioA');
  const [roomState, setRoomState] = useState(roomPresets.studioA);
  const [params, setParams] = useState(() => ({
    az: 0,
    el: 0,
    dist: 15,
    width: 30,
    r: 70,
    sp: 5,
    ew: 10,
    vol: 0.9,
    path: 'orbit' as PathMode
  }));
  const [playTime, setPlayTime] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rulerRef = useRef<HTMLCanvasElement>(null);
  const polarRef = useRef<HTMLCanvasElement>(null);
  const laneRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const meterInterval = useRef<number | null>(null);
  const animationFrame = useRef<number | null>(null);
  const lastTick = useRef<number>(performance.now());

  const selectedTrack = useMemo(() => tracks.find((track) => track.id === selectedId) || tracks[0], [selectedId, tracks]);
  const lastSyncedTrackId = useRef<string | null>(null);

  useEffect(() => {
    if (tracks.length === 0) return;
    if (!selectedTrack) {
      setSelectedId(tracks[0].id);
    }
  }, [tracks, selectedTrack]);

  useEffect(() => {
    if (!selectedTrack) return;
    const isNewTrack = lastSyncedTrackId.current !== selectedTrack.id;
    if (!isNewTrack) return;

    const next = deriveStemParams(selectedTrack);
    next.path = pathMode;
    if (!areParamSetsEqual(next, params)) {
      setParams(next);
    }
    lastSyncedTrackId.current = selectedTrack.id;
  }, [selectedTrack, pathMode]);

  useEffect(() => {
    setParams((current) =>
      current.path === pathMode ? current : { ...current, path: pathMode }
    );
  }, [pathMode]);

  const generatedPath = useMemo(() => {
    if (!selectedTrack) return [] as SpatialNode[];
    return buildPathFromParams(params, selectedTrack.analysis.duration || 16);
  }, [params, selectedTrack]);

  useEffect(() => {
    if (!selectedTrack) return;
    if (!arePathsEqual(generatedPath, selectedTrack.analysis.path)) {
      onUpdateTrackPath(selectedTrack.id, generatedPath);
    }
  }, [generatedPath, selectedTrack, onUpdateTrackPath]);

  useEffect(() => {
    if (!rulerRef.current) return;
    const canvas = rulerRef.current;
    const rect = canvas.parentElement?.getBoundingClientRect();
    if (!rect) return;
    const width = rect.width;
    const height = 20;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#08081a';
    ctx.fillRect(0, 0, width, height);
    const bars = 32;
    const bw = width / bars;
    for (let i = 0; i <= bars; i++) {
      const x = i * bw;
      const major = i % 4 === 0;
      ctx.strokeStyle = major ? '#1e1e38' : '#111128';
      ctx.lineWidth = major ? 0.8 : 0.5;
      ctx.beginPath();
      ctx.moveTo(x, major ? 0 : 8);
      ctx.lineTo(x, height);
      ctx.stroke();
      if (major) {
        ctx.fillStyle = '#2a2a50';
        ctx.font = "8px 'Courier New'";
        ctx.fillText(`${Math.floor(i / 4 + 1)}:00`, x + 2, 12);
      }
    }
  }, [tracks]);

  useEffect(() => {
    const renderLanes = () => {
      tracks.forEach((track, index) => {
        const canvas = laneRefs.current[index];
        if (!canvas) return;
        const width = canvas.parentElement?.clientWidth || 300;
        const height = 18;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = '#07070f';
        ctx.fillRect(0, 0, width, height);
        const pts = 32;
        const color = stemColors[track.type] || '#9090ff';
        for (let i = 0; i < pts; i++) {
          const x = (i / pts) * width;
          const val = 0.2 + Math.abs(Math.sin((i / pts) * Math.PI * 2 + index)) * 0.65;
          ctx.fillStyle = `${color}44`;
          ctx.fillRect(x, height * (1 - val), width / pts - 0.5, height * val);
        }
        ctx.strokeStyle = `${color}66`;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        for (let x = 0; x <= width; x += 2) {
          const y = height * 0.4 + Math.sin(x * 0.05 + index * 0.5) * height * 0.2;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      });
    };

    renderLanes();
    window.addEventListener('resize', renderLanes);
    return () => window.removeEventListener('resize', renderLanes);
  }, [tracks]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const polar = polarRef.current;
    if (!canvas || !polar) return;

    const drawField = () => {
      const rect = canvas.parentElement?.getBoundingClientRect();
      if (!rect) return;
      const width = rect.width;
      const height = rect.height;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#06060f';
      ctx.fillRect(0, 0, width, height);
      const cx = width / 2;
      const cy = height / 2;
      const radius = Math.min(width, height) * 0.42;
      ctx.strokeStyle = 'rgba(15,15,40,0.8)';
      ctx.lineWidth = 1;
      for (let i = 1; i <= 5; i++) {
        ctx.beginPath();
        ctx.arc(cx, cy, (radius / 5) * i, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(30,30,60,0.85)';
      ctx.beginPath();
      ctx.moveTo(cx - radius, cy);
      ctx.lineTo(cx + radius, cy);
      ctx.moveTo(cx, cy - radius);
      ctx.lineTo(cx, cy + radius);
      ctx.stroke();

      tracks.forEach((track) => {
        const node = track.analysis.path[0];
        if (!node) return;
        const px = cx + node.x * radius * 0.35;
        const py = cy - node.y * radius * 0.35;
        const color = stemColors[track.type] || '#9090ff';
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(px, py, track.id === selectedId ? 8 : 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.beginPath();
        ctx.arc(px, py, track.id === selectedId ? 12 : 8, 0, Math.PI * 2);
        ctx.fill();
      });
      const selected = tracks.find((track) => track.id === selectedId);
      if (selected) {
        const node = selected.analysis.path[0];
        if (node) {
          const px = cx + node.x * radius * 0.35;
          const py = cy - node.y * radius * 0.35;
          ctx.fillStyle = '#ffffff';
          ctx.font = '9px Courier New';
          ctx.fillText(selected.type.toUpperCase(), px + 10, py + 4);
        }
      }
    };

    const drawPolar = () => {
      const rect = polar.parentElement?.getBoundingClientRect();
      if (!rect) return;
      const width = rect.width;
      const height = rect.height;
      const dpr = window.devicePixelRatio || 1;
      polar.width = width * dpr;
      polar.height = height * dpr;
      polar.style.width = `${width}px`;
      polar.style.height = `${height}px`;
      const ctx = polar.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#09091e';
      ctx.fillRect(0, 0, width, height);
      const cx = width / 2;
      const cy = height / 2;
      const maxR = Math.min(cx, cy) - 6;
      ctx.strokeStyle = '#0c0c1e';
      ctx.lineWidth = 0.6;
      [0.33, 0.66, 1].forEach((mag) => {
        ctx.beginPath();
        ctx.arc(cx, cy, maxR * mag, 0, Math.PI * 2);
        ctx.stroke();
      });
      ctx.beginPath();
      ctx.moveTo(cx - maxR, cy);
      ctx.lineTo(cx + maxR, cy);
      ctx.moveTo(cx, cy - maxR);
      ctx.lineTo(cx, cy + maxR);
      ctx.stroke();
      const selected = tracks.find((track) => track.id === selectedId);
      if (selected) {
        const node = selected.analysis.path[0] || ({ x: 0, y: 0, z: 0 } as SpatialNode);
        const angle = Math.atan2(node.x, -node.z);
        const r = Math.sqrt(node.x * node.x + node.y * node.y) * maxR * 0.7;
        const px = cx + Math.sin(angle) * r;
        const py = cy - Math.cos(angle) * r;
        ctx.fillStyle = stemColors[selected.type] || '#9090ff';
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    drawField();
    drawPolar();
  }, [tracks, selectedId, viewMode, params]);

  useEffect(() => {
    meterInterval.current = window.setInterval(() => {
      const left = document.getElementById('mL');
      const right = document.getElementById('mR');
      const cpu = document.getElementById('mCPU');
      if (left) left.style.width = `${Math.round(40 + Math.random() * 40)}%`;
      if (right) right.style.width = `${Math.round(40 + Math.random() * 40)}%`;
      if (cpu) cpu.style.width = `${Math.round(22 + Math.random() * 12)}%`;
    }, 900);
    return () => {
      if (meterInterval.current) window.clearInterval(meterInterval.current);
    };
  }, []);

  useEffect(() => {
    if (!playing) return;
    const tick = (time: number) => {
      const delta = (time - lastTick.current) / 1000;
      lastTick.current = time;
      setPlayTime((prev) => {
        const next = prev + delta;
        if (looping && next > 16) return 0;
        return next;
      });
      animationFrame.current = requestAnimationFrame(tick);
    };
    lastTick.current = performance.now();
    animationFrame.current = requestAnimationFrame(tick);
    return () => {
      if (animationFrame.current) cancelAnimationFrame(animationFrame.current);
    };
  }, [playing, looping]);

  const updateParam = <K extends keyof typeof params>(key: K, value: typeof params[K]) => {
    setParams((current) => ({ ...current, [key]: value }));
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${m}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
  };

  return (
    <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-4 text-zinc-100">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.32em] text-zinc-500">Neon Spatial Mixer</div>
          <div className="mt-1 text-2xl font-semibold tracking-tight text-zinc-100">Spatial Network Editor</div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.24em] text-zinc-500">
          <span className="rounded-full border border-zinc-800 bg-zinc-900/80 px-3 py-1">Track: {selectedTrack?.name || selectedTrack?.type || 'Unknown'}</span>
          <span className="rounded-full border border-zinc-800 bg-zinc-900/80 px-3 py-1">Mode: {pathMode.toUpperCase()}</span>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)_320px]">
        <aside className="space-y-4">
          <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-4">
            <div className="text-xs uppercase tracking-[0.28em] text-zinc-500">Loaded Stems</div>
            <div className="mt-3 space-y-2 max-h-[520px] overflow-y-auto pr-1">
              {tracks.map((track) => {
                const color = stemColors[track.type] || '#9090ff';
                return (
                  <button
                    key={track.id}
                    className={`w-full rounded-2xl border px-3 py-3 text-left transition ${track.id === selectedId ? 'border-lime-400 bg-zinc-800 shadow-[0_0_20px_rgba(83,255,129,0.08)]' : 'border-zinc-800 bg-zinc-950/50 hover:border-zinc-600 hover:bg-zinc-900'}`}
                    style={{ '--sc': color } as React.CSSProperties}
                    onClick={() => setSelectedId(track.id)}
                  >
                    <div className="flex items-center gap-3">
                      <span className="inline-flex h-3.5 w-3.5 rounded-full" style={{ backgroundColor: color }} />
                      <span className="text-sm font-medium text-zinc-100 truncate">{track.name || track.type}</span>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                      <div className="space-y-0.5"><div>AZ</div><div className="text-zinc-300">{Math.round(params.az)}°</div></div>
                      <div className="space-y-0.5"><div>EL</div><div className="text-zinc-300">{Math.round(params.el)}°</div></div>
                      <div className="space-y-0.5"><div>DIST</div><div className="text-zinc-300">{(params.dist / 10).toFixed(1)}m</div></div>
                      <div className="space-y-0.5"><div>WIDTH</div><div className="text-zinc-300">{params.width}°</div></div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-4 space-y-3">
            <div className="text-xs uppercase tracking-[0.28em] text-zinc-500">Quick Place</div>
            <div className="grid grid-cols-2 gap-2">
              <button className="rounded-2xl border border-zinc-800 bg-zinc-950 py-2 text-xs uppercase tracking-[0.18em] text-zinc-300 transition hover:border-lime-400" onClick={() => updateParam('az', 0)}>Front</button>
              <button className="rounded-2xl border border-zinc-800 bg-zinc-950 py-2 text-xs uppercase tracking-[0.18em] text-zinc-300 transition hover:border-lime-400" onClick={() => updateParam('az', 180)}>Back</button>
              <button className="rounded-2xl border border-zinc-800 bg-zinc-950 py-2 text-xs uppercase tracking-[0.18em] text-zinc-300 transition hover:border-lime-400" onClick={() => updateParam('az', 270)}>Left</button>
              <button className="rounded-2xl border border-zinc-800 bg-zinc-950 py-2 text-xs uppercase tracking-[0.18em] text-zinc-300 transition hover:border-lime-400" onClick={() => updateParam('az', 90)}>Right</button>
              <button className="rounded-2xl border border-zinc-800 bg-zinc-950 py-2 text-xs uppercase tracking-[0.18em] text-zinc-300 transition hover:border-lime-400" onClick={() => { updateParam('az', 0); updateParam('el', 60); }}>Above</button>
              <button className="rounded-2xl border border-zinc-800 bg-zinc-950 py-2 text-xs uppercase tracking-[0.18em] text-zinc-300 transition hover:border-lime-400" onClick={() => { updateParam('az', 0); updateParam('el', -60); }}>Below</button>
              <button className="rounded-2xl border border-zinc-800 bg-zinc-950 py-2 text-xs uppercase tracking-[0.18em] text-zinc-300 transition hover:border-lime-400" onClick={() => { updateParam('dist', 30); updateParam('r', 30); }}>Close</button>
              <button className="rounded-2xl border border-zinc-800 bg-zinc-950 py-2 text-xs uppercase tracking-[0.18em] text-zinc-300 transition hover:border-lime-400" onClick={() => { updateParam('dist', 50); updateParam('r', 80); }}>Far</button>
            </div>
          </div>
        </aside>

        <div className="space-y-4">
          <div className="relative overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-900 shadow-[0_0_45px_rgba(0,0,0,0.12)]">
            <div className="flex flex-col gap-3 border-b border-zinc-800 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-xs uppercase tracking-[0.32em] text-zinc-500">Spatial Field</div>
                <div className="text-lg font-semibold text-zinc-100">Live Path Visualization</div>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.24em] text-zinc-400">
                <span className="rounded-full bg-zinc-950/80 px-3 py-1 border border-zinc-800">View: {viewMode}</span>
                <span className="rounded-full bg-zinc-950/80 px-3 py-1 border border-zinc-800">HRTF: {hrtfMode}</span>
                <span className="rounded-full bg-zinc-950/80 px-3 py-1 border border-zinc-800">Room: {roomPreset}</span>
              </div>
            </div>

            <div className="relative h-[380px] bg-[#06060f]">
              <canvas id="c3" ref={canvasRef} className="absolute inset-0 h-full w-full" />
              <div className="absolute inset-x-4 top-4 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-zinc-950/80 px-3 py-1 text-[10px] uppercase tracking-[0.24em] text-zinc-400">Field: {viewMode === 'persp' ? 'Spherical' : viewMode}</span>
                <span className="rounded-full bg-zinc-950/80 px-3 py-1 text-[10px] uppercase tracking-[0.24em] text-zinc-400">HRTF: {hrtfMode === 'kemar' ? 'KEMAR' : hrtfMode.toUpperCase()}</span>
              </div>
              <div className="absolute bottom-4 left-4 flex flex-wrap gap-2">
                <div className="rounded-full bg-zinc-950/80 px-3 py-1 text-[10px] uppercase tracking-[0.24em] text-zinc-400">Az {Math.round(params.az)}°</div>
                <div className="rounded-full bg-zinc-950/80 px-3 py-1 text-[10px] uppercase tracking-[0.24em] text-zinc-400">El {Math.round(params.el)}°</div>
                <div className="rounded-full bg-zinc-950/80 px-3 py-1 text-[10px] uppercase tracking-[0.24em] text-zinc-400">Dist {(params.dist / 10).toFixed(1)}m</div>
                <div className="rounded-full bg-zinc-950/80 px-3 py-1 text-[10px] uppercase tracking-[0.24em] text-zinc-400">Width {params.width}°</div>
              </div>
              <div className="absolute top-4 right-4 flex flex-wrap items-center gap-2">
                {(['persp', 'top', 'front', 'side'] as const).map((mode) => (
                  <button key={mode} className={`rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.18em] transition ${viewMode === mode ? 'border-lime-400 bg-lime-500/10 text-lime-300' : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-600'}`} onClick={() => setViewMode(mode)}>
                    {mode.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-zinc-800 bg-zinc-900 overflow-hidden">
            <div className="h-8 border-b border-zinc-800">
              <canvas id="ruler" ref={rulerRef} className="w-full h-full" />
            </div>
            <div className="max-h-[220px] overflow-y-auto">
              {tracks.map((track, index) => (
                <div key={track.id} className="flex h-14 items-center gap-3 border-b border-zinc-800 last:border-b-0 px-4">
                  <div className="w-24 text-[11px] uppercase tracking-[0.16em] text-zinc-500">{track.name || track.type}</div>
                  <div className="flex-1 relative h-full">
                    <canvas className="lane-cv absolute inset-0 h-full w-full" ref={(el) => { laneRefs.current[index] = el; }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-4 overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-900 p-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-3 text-xs uppercase tracking-[0.28em] text-zinc-500">Motion</div>
            <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-3 text-xs uppercase tracking-[0.28em] text-zinc-500">Room</div>
          </div>

          <div className="grid gap-3">
            <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-3 grid gap-3">
              <div className="grid grid-cols-2 gap-3 text-[10px] uppercase tracking-[0.18em] text-zinc-400">
                <div className="rounded-2xl bg-zinc-900/80 p-2">ITD</div>
                <div className="rounded-2xl bg-zinc-900/80 p-2">ILD</div>
                <div className="rounded-2xl bg-zinc-900/80 p-2">Near</div>
                <div className="rounded-2xl bg-zinc-900/80 p-2">Spread</div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm text-zinc-100">
                <div>{'0µs'}</div>
                <div>{'0dB'}</div>
                <div>{(params.dist / 10).toFixed(1)}m</div>
                <div>{params.width}°</div>
              </div>
            </div>

            <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-3 space-y-4 text-sm text-zinc-100">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs uppercase tracking-[0.18em] text-zinc-500">
                  <span>Orbit radius</span>
                  <span>{params.r}%</span>
                </div>
                <input type="range" min="5" max="100" step="1" value={params.r} onChange={(e) => updateParam('r', Number(e.target.value))} className="w-full accent-lime-400" />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs uppercase tracking-[0.18em] text-zinc-500">
                  <span>Speed</span>
                  <span>{(params.sp / 10).toFixed(1)}×</span>
                </div>
                <input type="range" min="0" max="40" step="1" value={params.sp} onChange={(e) => updateParam('sp', Number(e.target.value))} className="w-full accent-lime-400" />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs uppercase tracking-[0.18em] text-zinc-500">
                  <span>Elev wave</span>
                  <span>{params.ew}°</span>
                </div>
                <input type="range" min="0" max="70" step="1" value={params.ew} onChange={(e) => updateParam('ew', Number(e.target.value))} className="w-full accent-lime-400" />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs uppercase tracking-[0.18em] text-zinc-500">
                  <span>Volume</span>
                  <span>{Math.round(params.vol * 100)}%</span>
                </div>
                <input type="range" min="0" max="100" step="1" value={Math.round(params.vol * 100)} onChange={(e) => updateParam('vol', Number(e.target.value) / 100)} className="w-full accent-lime-400" />
              </div>
            </div>

            <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-3 space-y-3">
              <div className="text-xs uppercase tracking-[0.28em] text-zinc-500">Path Type</div>
              <div className="grid grid-cols-2 gap-2">
                {(['orbit', 'figure8', 'rise', 'fixed'] as PathMode[]).map((mode) => (
                  <button key={mode} className={`rounded-2xl border px-3 py-2 text-xs uppercase tracking-[0.18em] transition ${pathMode === mode ? 'border-lime-400 bg-lime-500/15 text-lime-200' : 'border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-zinc-600'}`} onClick={() => { setPathMode(mode); updateParam('path', mode); }}>
                    {mode === 'orbit' ? 'Orbit' : mode === 'figure8' ? 'Figure-8' : mode === 'rise' ? 'Rise' : 'Fixed'}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
