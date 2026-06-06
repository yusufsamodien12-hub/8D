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
    <div className="app">
      <style>{`*{box-sizing:border-box;margin:0;padding:0}
      .app{background:#06060f;display:flex;flex-direction:column;height:700px;font-family:'Courier New',monospace;font-size:11px;color:#7777aa;overflow:hidden}
      .topbar{background:#09091a;border-bottom:1px solid #111128;display:flex;align-items:center;gap:0;height:30px;flex-shrink:0;padding:0 8px}
      .song-title{color:#5555aa;font-size:10px;letter-spacing:.1em;padding:0 12px 0 4px;border-right:1px solid #111128;margin-right:8px}
      .song-title span{color:#9090ff}
      .transport{display:flex;align-items:center;gap:6px}
      .tbtn{background:transparent;border:0.5px solid #1a1a35;border-radius:3px;color:#444488;font-family:'Courier New',monospace;font-size:10px;padding:2px 8px;cursor:pointer;letter-spacing:.06em}
      .tbtn:hover{color:#7070cc;border-color:#2a2a55}
      .tbtn.on{color:#9090ff;border-color:#4040a0;background:#0d0d28}
      .timecode{font-size:12px;color:#6060cc;letter-spacing:.12em;padding:0 10px;border-left:1px solid #111128;border-right:1px solid #111128;margin:0 6px}
      .bpm-box{font-size:9px;color:#333360;padding:0 8px;border-right:1px solid #111128}
      .bpm-box span{color:#5050a0}
      .meters{margin-left:auto;display:flex;align-items:center;gap:8px}
      .m-bar{width:50px;height:3px;background:#0d0d1e;border-radius:2px;overflow:hidden}
      .m-fill{height:100%;border-radius:2px}
      .m-lbl{font-size:8px;color:#2a2a4a;letter-spacing:.08em}
      .body{display:flex;flex:1;overflow:hidden}
      .left-panel{width:200px;flex-shrink:0;background:#080814;border-right:1px solid #0f0f22;display:flex;flex-direction:column;overflow:hidden}
      .lp-head{padding:8px 10px;border-bottom:0.5px solid #0f0f22;font-size:8px;color:#2a2a50;letter-spacing:.12em;text-transform:uppercase}
      .stem-list{flex:1;overflow-y:auto}
      .stem-list::-webkit-scrollbar{width:2px}
      .stem-list::-webkit-scrollbar-thumb{background:#111128}
      .stem-entry{padding:7px 10px;border-bottom:0.5px solid #0c0c1e;cursor:pointer;transition:background .1s;color:#9090cc}
      .stem-entry:hover{background:#0d0d22}
      .stem-entry.sel{background:#0f0f26;border-left:2px solid var(--sc)}
      .stem-top{display:flex;align-items:center;gap:7px;margin-bottom:5px}
      .s-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;background:var(--sc)}
      .s-name{font-size:10px;color:#8080b0;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .stem-entry.sel .s-name{color:#b0b0e0}
      .stem-params{display:grid;grid-template-columns:1fr 1fr;gap:3px 8px;font-size:8px}
      .sp-item{display:flex;flex-direction:column;gap:1px}
      .sp-lbl{color:#303050;letter-spacing:.06em;font-size:7px;text-transform:uppercase}
      .sp-val{color:#6060a0;font-size:9px}
      .vstrip{display:flex;gap:2px;margin-top:4px;align-items:flex-end;height:14px}
      .vbar{flex:1;background:#0d0d20;border-radius:1px;overflow:hidden;height:100%;display:flex;align-items:flex-end}
      .vbar-fill{width:100%;border-radius:1px;transition:height .08s}
      .mid-col{flex:1;display:flex;flex-direction:column;overflow:hidden}
      .viewport3d{flex:1;position:relative;overflow:hidden;background:#06060f;min-height:0}
      canvas#c3{display:block;width:100%;height:100%}
      .v-hud{position:absolute;top:6px;left:6px;display:flex;flex-direction:column;gap:3px;pointer-events:none}
      .hud-pill{background:rgba(6,6,15,.9);border:0.5px solid #111128;border-radius:3px;padding:2px 7px;font-size:8px;color:#4444aa;letter-spacing:.08em}
      .hud-pill span{color:#8888ff}
      .view-sw{position:absolute;top:6px;right:6px;display:flex;gap:3px}
      .vbtn{background:rgba(8,8,20,.9);border:0.5px solid #111128;border-radius:3px;padding:2px 8px;font-size:8px;color:#333366;cursor:pointer;letter-spacing:.06em}
      .vbtn.on{color:#7777ff;border-color:#303090}
      .coord-row{position:absolute;bottom:6px;left:6px;display:flex;gap:5px}
      .cbox{background:rgba(6,6,15,.9);border:0.5px solid #0f0f22;border-radius:3px;padding:3px 8px}
      .c-lbl{font-size:7px;color:#2a2a4a;text-transform:uppercase;letter-spacing:.1em}
      .c-val{font-size:12px;color:#6666ff;font-weight:500;margin-top:1px}
      .timeline-area{height:140px;flex-shrink:0;background:#07070f;border-top:1px solid #0f0f22;display:flex;flex-direction:column;overflow:hidden}
      .tl-ruler{height:20px;background:#08081a;border-bottom:0.5px solid #0f0f22;position:relative;flex-shrink:0}
      canvas#ruler{display:block;width:100%;height:100%}
      .tl-lanes{flex:1;overflow-y:auto;overflow-x:hidden}
      .tl-lanes::-webkit-scrollbar{width:2px;height:2px}
      .tl-lanes::-webkit-scrollbar-thumb{background:#111128}
      .tl-lane{display:flex;height:18px;border-bottom:0.5px solid #0a0a18;align-items:center}
      .lane-label{width:90px;flex-shrink:0;padding:0 8px;font-size:8px;color:#333360;letter-spacing:.05em;border-right:0.5px solid #0d0d20;overflow:hidden;white-space:nowrap}
      .lane-canvas-wrap{flex:1;position:relative;height:100%;overflow:hidden}
      canvas.lane-cv{display:block;width:100%;height:100%;position:absolute;top:0;left:0}
      .right-panel{width:200px;flex-shrink:0;background:#080814;border-left:1px solid #0f0f22;display:flex;flex-direction:column;overflow:hidden}
      .rp-tabs{display:flex;border-bottom:0.5px solid #0f0f22}
      .rptab{flex:1;padding:5px 0;text-align:center;font-size:8px;color:#2a2a4a;letter-spacing:.08em;cursor:pointer;border-right:0.5px solid #0f0f22}
      .rptab:last-child{border-right:none}
      .rptab.on{color:#6666cc;background:#0a0a1e}
      .rp-body{flex:1;overflow-y:auto;padding:8px}
      .rp-body::-webkit-scrollbar{width:2px}
      .rp-body::-webkit-scrollbar-thumb{background:#111128}
      .ctrl-grp{margin-bottom:10px}
      .cg-title{font-size:8px;color:#2a2a48;letter-spacing:.1em;text-transform:uppercase;margin-bottom:6px;padding-bottom:3px;border-bottom:0.5px solid #0d0d20}
      .ctrl-row{margin-bottom:6px}
      .cr-head{display:flex;justify-content:space-between;margin-bottom:2px}
      .cr-lbl{font-size:8px;color:#404068;letter-spacing:.05em}
      .cr-val{font-size:9px;color:#6666b0;font-weight:500}
      input[type=range]{width:100%;height:2px;accent-color:#5555bb;cursor:pointer}
      .analysis-mini{display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:8px}
      .am-box{background:#09091e;border:0.5px solid #0f0f28;border-radius:4px;padding:5px 7px}
      .am-lbl{font-size:7px;color:#2a2a4a;letter-spacing:.1em;text-transform:uppercase}
      .am-val{font-size:13px;color:#5555cc;font-weight:500;margin-top:2px}
      .polar-mini{height:80px;margin-bottom:8px;border-radius:4px;overflow:hidden}
      canvas#polmini{display:block;width:100%;height:100%}
      .enum-row{display:flex;gap:3px;flex-wrap:wrap;margin-bottom:6px}
      .etag{padding:2px 6px;border-radius:3px;font-size:8px;border:0.5px solid #111128;color:#303060;cursor:pointer;letter-spacing:.04em}
      .etag.on{background:#0d0d2a;border-color:#282880;color:#6666dd}
      .etag:hover{color:#5050a0}
      .snap-grid{display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:6px}
      .snap-btn{padding:4px 0;border-radius:3px;border:0.5px solid #111128;background:transparent;color:#303060;font-family:'Courier New',monospace;font-size:8px;letter-spacing:.04em;cursor:pointer;text-align:center}
      .snap-btn:hover{color:#5555aa;border-color:#222260}
      .analysis-mini{display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:8px}
      .am-box{background:#09091e;border:0.5px solid #0f0f28;border-radius:4px;padding:5px 7px}
      .am-lbl{font-size:7px;color:#2a2a4a;letter-spacing:.1em;text-transform:uppercase}
      .am-val{font-size:13px;color:#5555cc;font-weight:500;margin-top:2px}
      `}</style>
      <div className="topbar">
        <div className="song-title">PROJECT: <span>NEON HYMN</span></div>
        <div className="transport">
          <button className="tbtn" onClick={() => { setPlayTime(0); setPlaying(false); }}>⏮</button>
          <button className={`tbtn ${playing ? 'on' : ''}`} onClick={() => setPlaying((p) => !p)}>{playing ? '⏸ PAUSE' : '▶ PLAY'}</button>
          <button className="tbtn" onClick={() => { setPlaying(false); setPlayTime(0); }}>⏹</button>
          <button className={`tbtn ${looping ? 'on' : ''}`} onClick={() => setLooping((l) => !l)}>⟳ LOOP</button>
        </div>
        <div className="timecode">{formatTime(playTime)}</div>
        <div className="bpm-box">BPM <span>128</span> · 4/4</div>
        <div className="meters">
          <span className="m-lbl">L</span><div className="m-bar"><div className="m-fill" id="mL" style={{ background: '#4444aa', width: '45%' }} /></div>
          <span className="m-lbl">R</span><div className="m-bar"><div className="m-fill" id="mR" style={{ background: '#4444aa', width: '50%' }} /></div>
          <span className="m-lbl">CPU</span><div className="m-bar"><div className="m-fill" id="mCPU" style={{ background: '#333388', width: '28%' }} /></div>
        </div>
      </div>
      <div className="body">
        <div className="left-panel">
          <div className="lp-head">SONG STEMS</div>
          <div className="stem-list">
            {tracks.map((track) => {
              const color = stemColors[track.type] || '#9090ff';
              return (
                <div key={track.id} className={`stem-entry${track.id === selectedId ? ' sel' : ''}`} style={{ '--sc': color } as React.CSSProperties} onClick={() => setSelectedId(track.id)}>
                  <div className="stem-top">
                    <div className="s-dot" />
                    <span className="s-name">{track.name || track.type}</span>
                  </div>
                  <div className="stem-params">
                    <div className="sp-item"><div className="sp-lbl">AZ</div><div className="sp-val">{Math.round(params.az)}°</div></div>
                    <div className="sp-item"><div className="sp-lbl">EL</div><div className="sp-val">{Math.round(params.el)}°</div></div>
                    <div className="sp-item"><div className="sp-lbl">DIST</div><div className="sp-val">{(params.dist / 10).toFixed(1)}m</div></div>
                    <div className="sp-item"><div className="sp-lbl">WIDTH</div><div className="sp-val">{params.width}°</div></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="mid-col">
          <div className="viewport3d">
            <canvas id="c3" ref={canvasRef} />
            <div className="v-hud">
              <div className="hud-pill">FIELD: <span>{viewMode === 'persp' ? 'SPHERICAL' : viewMode.toUpperCase()}</span></div>
              <div className="hud-pill">HRTF: <span>{hrtfMode === 'kemar' ? 'KEMAR' : hrtfMode.toUpperCase()}</span></div>
              <div className="hud-pill">ROOM: <span>{roomPreset === 'studioA' ? 'STUDIO A' : roomPreset.toUpperCase()}</span></div>
            </div>
            <div className="view-sw">
              <button className={`vbtn ${viewMode === 'persp' ? 'on' : ''}`} onClick={() => setViewMode('persp')}>PERSP</button>
              <button className={`vbtn ${viewMode === 'top' ? 'on' : ''}`} onClick={() => setViewMode('top')}>TOP</button>
              <button className={`vbtn ${viewMode === 'front' ? 'on' : ''}`} onClick={() => setViewMode('front')}>FRONT</button>
              <button className={`vbtn ${viewMode === 'side' ? 'on' : ''}`} onClick={() => setViewMode('side')}>SIDE</button>
            </div>
            <div className="coord-row">
              <div className="cbox"><div className="c-lbl">Az</div><div className="c-val">{Math.round(params.az)}°</div></div>
              <div className="cbox"><div className="c-lbl">El</div><div className="c-val">{Math.round(params.el)}°</div></div>
              <div className="cbox"><div className="c-lbl">Dist</div><div className="c-val">{(params.dist / 10).toFixed(1)}m</div></div>
              <div className="cbox"><div className="c-lbl">Width</div><div className="c-val">{params.width}°</div></div>
            </div>
          </div>
          <div className="timeline-area">
            <div className="tl-ruler"><canvas id="ruler" ref={rulerRef} /></div>
            <div className="tl-lanes">
              {tracks.map((track, index) => (
                <div key={track.id} className="tl-lane">
                  <div className="lane-label">{track.name || track.type}</div>
                  <div className="lane-canvas-wrap">
                    <canvas className="lane-cv" ref={(el) => { laneRefs.current[index] = el; }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="right-panel">
          <div className="rp-tabs">
            <div className="rptab on">SPATIAL</div>
            <div className="rptab">BINAURAL</div>
            <div className="rptab">ROOM</div>
          </div>
          <div className="rp-body">
            <div className="polar-mini"><canvas id="polmini" ref={polarRef} /></div>
            <div className="analysis-mini">
              <div className="am-box"><div className="am-lbl">ITD</div><div className="am-val">0µs</div></div>
              <div className="am-box"><div className="am-lbl">ILD</div><div className="am-val">0dB</div></div>
              <div className="am-box"><div className="am-lbl">NEAR</div><div className="am-val">{(params.dist / 10).toFixed(1)}m</div></div>
              <div className="am-box"><div className="am-lbl">SPREAD</div><div className="am-val">{params.width}°</div></div>
            </div>
            <div className="ctrl-grp">
              <div className="cg-title">POSITION</div>
              <div className="ctrl-row"><div className="cr-head"><span className="cr-lbl">AZIMUTH (L ↔ R)</span><span className="cr-val">{Math.round(params.az)}°</span></div><input type="range" min="0" max="359" step="1" value={params.az} onChange={(e) => updateParam('az', Number(e.target.value))} /></div>
              <div className="ctrl-row"><div className="cr-head"><span className="cr-lbl">ELEVATION (↓ ↑)</span><span className="cr-val">{Math.round(params.el)}°</span></div><input type="range" min="-80" max="80" step="1" value={params.el} onChange={(e) => updateParam('el', Number(e.target.value))} /></div>
              <div className="ctrl-row"><div className="cr-head"><span className="cr-lbl">DISTANCE (FAR ↔ NEAR)</span><span className="cr-val">{(params.dist / 10).toFixed(1)}m</span></div><input type="range" min="10" max="60" step="1" value={params.dist} onChange={(e) => updateParam('dist', Number(e.target.value))} /></div>
              <div className="ctrl-row"><div className="cr-head"><span className="cr-lbl">SPREAD / WIDTH</span><span className="cr-val">{params.width}°</span></div><input type="range" min="0" max="180" step="1" value={params.width} onChange={(e) => updateParam('width', Number(e.target.value))} /></div>
            </div>
            <div className="ctrl-grp">
              <div className="cg-title">ORBIT</div>
              <div className="ctrl-row"><div className="cr-head"><span className="cr-lbl">ORBIT RADIUS</span><span className="cr-val">{params.r}%</span></div><input type="range" min="5" max="100" step="1" value={params.r} onChange={(e) => updateParam('r', Number(e.target.value))} /></div>
              <div className="ctrl-row"><div className="cr-head"><span className="cr-lbl">SPEED</span><span className="cr-val">{(params.sp / 10).toFixed(1)}×</span></div><input type="range" min="0" max="40" step="1" value={params.sp} onChange={(e) => updateParam('sp', Number(e.target.value))} /></div>
              <div className="ctrl-row"><div className="cr-head"><span className="cr-lbl">ELEV WAVE</span><span className="cr-val">{params.ew}°</span></div><input type="range" min="0" max="70" step="1" value={params.ew} onChange={(e) => updateParam('ew', Number(e.target.value))} /></div>
            </div>
            <div className="ctrl-grp">
              <div className="cg-title">VOLUME</div>
              <div className="ctrl-row"><div className="cr-head"><span className="cr-lbl">LEVEL</span><span className="cr-val">{Math.round(params.vol * 100)}%</span></div><input type="range" min="0" max="100" step="1" value={Math.round(params.vol * 100)} onChange={(e) => updateParam('vol', Number(e.target.value) / 100)} /></div>
            </div>
            <div className="ctrl-grp">
              <div className="cg-title">QUICK PLACE</div>
              <div className="snap-grid">
                <button className="snap-btn" onClick={() => updateParam('az', 0)}>FRONT</button>
                <button className="snap-btn" onClick={() => updateParam('az', 180)}>BACK</button>
                <button className="snap-btn" onClick={() => updateParam('az', 270)}>LEFT</button>
                <button className="snap-btn" onClick={() => updateParam('az', 90)}>RIGHT</button>
                <button className="snap-btn" onClick={() => { updateParam('az', 0); updateParam('el', 60); }}>ABOVE</button>
                <button className="snap-btn" onClick={() => { updateParam('az', 0); updateParam('el', -60); }}>BELOW</button>
                <button className="snap-btn" onClick={() => { updateParam('dist', 30); updateParam('r', 30); }}>CLOSE</button>
                <button className="snap-btn" onClick={() => { updateParam('dist', 50); updateParam('r', 80); }}>FAR</button>
              </div>
            </div>
            <div className="ctrl-grp">
              <div className="cg-title">PATH TYPE</div>
              <div className="enum-row">
                {(['orbit', 'figure8', 'rise', 'fixed'] as PathMode[]).map((mode) => (
                  <div key={mode} className={`etag ${pathMode === mode ? 'on' : ''}`} onClick={() => { setPathMode(mode); updateParam('path', mode); }}>
                    {mode === 'orbit' ? 'Orbit' : mode === 'figure8' ? 'Figure-8' : mode === 'rise' ? 'Rise' : 'Fixed'}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
