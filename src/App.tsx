import React, { useState, useEffect, Suspense } from 'react';
import { audioEngine } from './lib/audio';
import { AppState, Track, HeadphoneProfile } from './types';
import { FileUpload } from './components/FileUpload';
const AutomationTimeline = React.lazy(() => import('./components/AutomationTimeline').then(m => ({ default: m.AutomationTimeline })));
const SpectrumVisualizer = React.lazy(() => import('./components/SpectrumVisualizer').then(m => ({ default: m.SpectrumVisualizer })));
const SpatialHead = React.lazy(() => import('./components/SpatialHead').then(m => ({ default: m.SpatialHead })));
const SpatialNetworkEditor = React.lazy(() => import('./components/SpatialNetworkEditor').then(m => ({ default: m.SpatialNetworkEditor })));
import { ExportButton } from './components/ExportButton';
import { TrackMixer } from './components/TrackMixer';
import { Play, Pause, Square, Radar, SkipBack } from 'lucide-react';

export default function App() {
  const [appState, setAppState] = useState<AppState>('idle');
  const [tracks, setTracks] = useState<Track[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [reverbLevel, setReverbLevel] = useState(0.25);
  const [profile, setProfile] = useState<HeadphoneProfile>('flat');
  const [spatialCalibration, setSpatialCalibration] = useState(1.0);
  const [automationScale, setAutomationScale] = useState(1.0);
  const [calibrationStatus, setCalibrationStatus] = useState<'not-tested' | 'testing' | 'ready'>('not-tested');

  useEffect(() => {
    audioEngine.onTimeUpdate((time) => setCurrentTime(time));
    audioEngine.onEnded(() => setIsPlaying(false));
  }, []);

  useEffect(() => {
    audioEngine.setReverbLevel(reverbLevel);
  }, [reverbLevel]);

  useEffect(() => {
    audioEngine.setProfile(profile);
  }, [profile]);

  useEffect(() => {
    if (typeof audioEngine.setSpatialCalibration === 'function') {
      audioEngine.setSpatialCalibration(spatialCalibration);
    }
    setCalibrationStatus('not-tested');
  }, [spatialCalibration]);

  useEffect(() => {
    if (typeof audioEngine.setAutomationScale === 'function') {
      audioEngine.setAutomationScale(automationScale);
    }
  }, [automationScale]);

  const handleCalibrationTest = async () => {
    if (calibrationStatus === 'testing') return;
    setCalibrationStatus('testing');
    try {
      if (typeof audioEngine.playCalibrationTone === 'function') {
        await audioEngine.playCalibrationTone();
        setCalibrationStatus('ready');
      } else {
        setCalibrationStatus('not-tested');
      }
    } catch (e) {
      console.error(e);
      setCalibrationStatus('not-tested');
      alert('Calibration test failed. Please try again.');
    }
  };

  const handleFileSelect = async (file: File) => {
    if (calibrationStatus !== 'ready' && tracks.length === 0) {
      return;
    }
    setAppState('analyzing');
    try {
      const newTracks = await audioEngine.loadAndSplitFile(file);
      const allTracks = [...tracks, ...newTracks];
      setTracks(allTracks);
      setDuration(audioEngine.duration);
      setAppState('ready');
    } catch (e) {
      console.error(e);
      setAppState(tracks.length > 0 ? 'ready' : 'idle');
      alert("Error parsing audio files.");
    }
  };

  const handleUpdateTrack = (id: string, updates: Partial<Track>) => {
    const newTracks = tracks.map(t => t.id === id ? { ...t, ...updates } : t);
    setTracks(newTracks);
    audioEngine.setTrackState(newTracks);
  };

  const handleUpdateTrackPath = (id: string, path: Track['analysis']['path']) => {
    const newTracks = tracks.map((track) => track.id === id ? { ...track, analysis: { ...track.analysis, path } } : track);
    setTracks(newTracks);
    if (typeof audioEngine.updateTrackPath === 'function') {
      audioEngine.updateTrackPath(id, path);
    } else {
      audioEngine.setTrackState(newTracks);
    }
  };

  const handleRemoveTrack = (id: string) => {
    audioEngine.deleteTrack(id);
    const newTracks = tracks.filter(t => t.id !== id);
    setTracks(newTracks);
    setDuration(audioEngine.duration);
    if (newTracks.length === 0) {
      setAppState('idle');
      setIsPlaying(false);
    }
  };

  const togglePlayback = () => {
    if (tracks.length === 0) return;
    if (isPlaying) audioEngine.pause();
    else audioEngine.play();
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
        <div className="max-w-7xl mx-auto px-6 py-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
             <div className="w-10 h-10 rounded-3xl bg-lime-400 flex items-center justify-center text-zinc-950 shadow-[0_0_20px_rgba(163,230,53,0.25)]">
               <Radar size={22} className="animate-[spin_4s_linear_infinite]" />
             </div>
             <div>
               <h1 className="text-xl md:text-2xl font-bold tracking-tight">Expert 8D Spatializer</h1>
               <p className="text-xs md:text-sm text-zinc-500 font-mono tracking-widest uppercase mt-1">A calm, high-fidelity multitrack spatial mixing experience</p>
             </div>
          </div>
          <div className="rounded-full bg-zinc-950/70 border border-zinc-800 px-4 py-2 text-xs font-mono uppercase tracking-widest text-zinc-400 flex items-center gap-2">
             <span className="w-2 h-2 rounded-full bg-lime-500 animate-pulse" />
             Auto-split stem matrix ready
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-10 pb-16">
        
        {appState !== 'ready' && tracks.length === 0 && (
           <section className="max-w-3xl mx-auto mt-12">
             <FileUpload 
               onFileSelect={handleFileSelect} 
               isLoading={appState === 'analyzing'}
               spatialCalibration={spatialCalibration}
               onSpatialCalibrationChange={setSpatialCalibration}
               calibrationStatus={calibrationStatus}
               onCalibrationTest={handleCalibrationTest}
               allowUpload={calibrationStatus === 'ready'}
             />
           </section>
        )}

        {tracks.length > 0 && (
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.8fr)_360px] gap-8">
            
            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                 <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-5 flex flex-col justify-between gap-3">
                   <span className="text-[10px] font-mono font-bold text-zinc-500 uppercase tracking-[0.32em]">Loaded Stems</span>
                   <div className="text-3xl font-bold text-lime-400">{tracks.length}</div>
                 </div>
                 <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-5 flex flex-col justify-between gap-3">
                   <span className="text-[10px] font-mono font-bold text-zinc-500 uppercase tracking-[0.32em]">Spatial Mode</span>
                   <div className="text-xl font-semibold text-zinc-200">Psychoacoustic 8D</div>
                 </div>
                 <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-5 flex flex-col justify-between gap-3">
                   <span className="text-[10px] font-mono font-bold text-zinc-500 uppercase tracking-[0.32em]">Engine</span>
                   <div className="text-xl font-semibold text-zinc-200">HRTF Immersion</div>
                 </div>
                 <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-5 flex flex-col justify-between gap-3">
                   <span className="text-[10px] font-mono font-bold text-zinc-500 uppercase tracking-[0.32em]">Timeline</span>
                   <div className="text-2xl font-bold font-mono text-zinc-100">{formatTime(currentTime)} / {formatTime(duration)}</div>
                 </div>
              </div>

              <Suspense fallback={<div className="w-full h-28 bg-zinc-900 border border-zinc-800 rounded-3xl flex items-center justify-center">Loading Visualizer...</div>}>
                <SpectrumVisualizer isPlaying={isPlaying} />
              </Suspense>

              <Suspense fallback={<div className="w-full h-36 bg-zinc-900 border border-zinc-800 rounded-3xl flex items-center justify-center">Loading Timeline...</div>}>
                <AutomationTimeline 
                  tracks={tracks}
                  currentTime={currentTime} 
                  duration={duration}
                  onSeek={handleSeek} 
                  automationScale={automationScale}
                  onAutomationScaleChange={setAutomationScale}
                />
              </Suspense>

              <Suspense fallback={<div className="w-full h-[420px] bg-zinc-900 border border-zinc-800 rounded-3xl flex items-center justify-center">Loading Network Editor...</div>}>
                <SpatialNetworkEditor
                  tracks={tracks}
                  currentTime={currentTime}
                  onUpdateTrackPath={handleUpdateTrackPath}
                />
              </Suspense>

              <Suspense fallback={<div className="w-full h-52 bg-zinc-900 border border-zinc-800 rounded-3xl flex items-center justify-center">Loading Spatial View...</div>}>
                <SpatialHead 
                  tracks={tracks}
                  currentTime={currentTime}
                />
              </Suspense>

              <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-5">
                <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <button 
                      onClick={stop}
                      className="w-14 h-14 rounded-full bg-zinc-900 border border-zinc-800 hover:border-lime-400 text-zinc-300 flex items-center justify-center transition-all"
                    >
                      <SkipBack size={22} />
                    </button>
                    <button 
                      onClick={togglePlayback}
                      className="w-16 h-16 rounded-full bg-lime-400 hover:bg-lime-300 text-zinc-950 transition-all shadow-[0_0_24px_rgba(163,230,53,0.25)] flex items-center justify-center"
                    >
                      {isPlaying ? <Pause size={28} /> : <Play size={28} />}
                    </button>
                    <button 
                      onClick={() => { audioEngine.clear(); setTracks([]); }}
                      className="w-14 h-14 rounded-full bg-zinc-900 border border-zinc-800 hover:border-red-400 text-red-400 transition-all flex items-center justify-center"
                      title="Clear Project"
                    >
                      <Square size={18} />
                    </button>
                  </div>

                  <div className="flex-1 md:flex-none text-sm font-mono text-zinc-400">
                    {appState === 'analyzing' ? (
                      <span className="inline-flex items-center gap-2 text-lime-400 animate-pulse">Extracting stems...</span>
                    ) : (
                      <span className="text-zinc-300">Ready to mix, automate, and export your stem spatialization.</span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-6">
               <div className="sticky top-6 space-y-6">
                 <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-5">
                    <h2 className="text-sm font-semibold text-zinc-100 mb-3">Project Controls</h2>
                    <FileUpload 
                      onFileSelect={handleFileSelect}
                      isLoading={appState === 'analyzing'}
                      spatialCalibration={spatialCalibration}
                      onSpatialCalibrationChange={setSpatialCalibration}
                      calibrationStatus={calibrationStatus}
                      onCalibrationTest={handleCalibrationTest}
                      allowUpload={true}
                    />
                    <div className="mt-4">
                      <ExportButton tracks={tracks} />
                    </div>
                 </div>

                 <TrackMixer 
                    tracks={tracks}
                    currentTime={currentTime}
                    onUpdateTrack={handleUpdateTrack}
                    onRemoveTrack={handleRemoveTrack}
                    reverbLevel={reverbLevel}
                    onReverbLevelChange={setReverbLevel}
                    profile={profile}
                    onProfileChange={setProfile}
                    spatialCalibration={spatialCalibration}
                    onSpatialCalibrationChange={setSpatialCalibration}
                 />
               </div>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}
