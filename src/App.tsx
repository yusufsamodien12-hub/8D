import React, { useState, useEffect } from 'react';
import { audioEngine } from './lib/audio';
import { AppState, AudioAnalysisResult } from './types';
import { FileUpload } from './components/FileUpload';
import { AutomationTimeline } from './components/AutomationTimeline';
import { SpectrumVisualizer } from './components/SpectrumVisualizer';
import { SpatialHead } from './components/SpatialHead';
import { Play, Pause, Square, Activity, Radar, SkipBack } from 'lucide-react';

export default function App() {
  const [appState, setAppState] = useState<AppState>('idle');
  const [analysis, setAnalysis] = useState<AudioAnalysisResult | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  useEffect(() => {
    audioEngine.onTimeUpdate((time) => setCurrentTime(time));
    audioEngine.onEnded(() => setIsPlaying(false));
  }, []);

  const handleFileSelect = async (file: File) => {
    setAppState('analyzing');
    try {
      await audioEngine.loadFile(file);
      setAnalysis(audioEngine.analysis);
      setCurrentTime(0);
      setAppState('ready');
    } catch (e) {
      console.error(e);
      setAppState('idle');
      alert("Error parsing audio. Try another file.");
    }
  };

  const togglePlayback = () => {
    if (isPlaying) {
      audioEngine.pause();
    } else {
      audioEngine.play();
    }
    setIsPlaying(!isPlaying);
  };

  const stop = () => {
    audioEngine.seek(0);
    audioEngine.pause();
    setIsPlaying(false);
  };

  const handleSeek = (time: number) => {
    audioEngine.seek(time);
    setCurrentTime(time);
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans selection:bg-lime-500/30">
      
      <header className="bg-zinc-900 border-b border-zinc-800">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
             <div className="w-8 h-8 rounded bg-lime-400 flex items-center justify-center text-zinc-950">
               <Radar size={20} className="animate-[spin_4s_linear_infinite]" />
             </div>
             <div>
               <h1 className="font-bold tracking-tight">8D Auto-Spatializer</h1>
               <p className="text-[10px] text-zinc-500 font-mono tracking-widest uppercase mt-0.5">Automated HRTF Vector Path</p>
             </div>
          </div>
          <div className="flex items-center gap-2">
             <span className="w-2 h-2 rounded-full bg-lime-500 animate-pulse" />
             <span className="text-xs font-mono text-zinc-400 uppercase tracking-widest leading-none">WebAudio Engine Online</span>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-10 space-y-8">
        
        {appState !== 'ready' && (
           <section className="max-w-2xl mx-auto">
             <FileUpload onFileSelect={handleFileSelect} isLoading={appState === 'analyzing'} />
           </section>
        )}

        {appState === 'ready' && analysis && (
          <div className="space-y-6">
            
            {/* Top Stats Row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
               <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 flex flex-col justify-between">
                 <span className="text-[10px] font-mono font-bold text-zinc-500 tracking-wider">DETECTED TEMPO</span>
                 <div className="text-2xl font-bold flex items-baseline gap-1 mt-1">
                   {analysis.bpm} <span className="text-sm font-normal text-zinc-400">BPM</span>
                 </div>
               </div>
               <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 flex flex-col justify-between">
                 <span className="text-[10px] font-mono font-bold text-zinc-500 tracking-wider">GENERATED NODES</span>
                 <div className="text-2xl font-bold text-lime-400 mt-1">
                   {analysis.path.length}
                 </div>
               </div>
               <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 flex flex-col justify-between">
                 <span className="text-[10px] font-mono font-bold text-zinc-500 tracking-wider">PATH DENSITY</span>
                 <div className="text-2xl font-bold mt-1">
                   High
                 </div>
               </div>
               <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 flex flex-col justify-between">
                 <span className="text-[10px] font-mono font-bold text-zinc-500 tracking-wider">ELAPSED TIME</span>
                 <div className="text-2xl font-bold font-mono mt-1">
                   {formatTime(currentTime)} / {formatTime(analysis.duration)}
                 </div>
               </div>
            </div>

            <SpectrumVisualizer isPlaying={isPlaying} />

            {/* Automation Envelope Timeline */}
            <AutomationTimeline 
              analysis={analysis} 
              currentTime={currentTime} 
              onSeek={handleSeek} 
            />

            {/* 3D Visualizer Canvas Section */}
            <SpatialHead 
              analysis={analysis}
              currentTime={currentTime}
            />

            {/* Transport Bar */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex items-center justify-center gap-4">
                <button 
                  onClick={stop}
                  className="w-12 h-12 flex items-center justify-center rounded-full hover:bg-zinc-800 text-zinc-400 transition-colors"
                >
                  <SkipBack size={20} fill="currentColor" />
                </button>
                <button 
                  onClick={togglePlayback}
                  className="w-16 h-16 flex items-center justify-center rounded-full bg-lime-400 hover:bg-lime-300 text-zinc-900 transition-colors shadow-[0_0_20px_rgba(163,230,53,0.3)] hover:shadow-[0_0_30px_rgba(163,230,53,0.5)]"
                >
                  {isPlaying ? <Pause size={28} fill="currentColor" /> : <Play size={28} fill="currentColor" className="ml-1" />}
                </button>
                <button 
                  onClick={() => window.location.reload()}
                  className="w-12 h-12 flex items-center justify-center rounded-full hover:bg-zinc-800 text-zinc-400 transition-colors"
                >
                  <Square size={18} fill="currentColor" />
                </button>
            </div>

          </div>
        )}

      </main>
    </div>
  );
}
