import React, { useState, useEffect } from 'react';
import { audioEngine } from './lib/audio';
import { AppState, Track, HeadphoneProfile } from './types';
import { FileUpload } from './components/FileUpload';
import { AutomationTimeline } from './components/AutomationTimeline';
import { SpectrumVisualizer } from './components/SpectrumVisualizer';
import { SpatialHead } from './components/SpatialHead';
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

  const handleFileSelect = async (file: File) => {
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
        <div className="max-w-7xl mx-auto px-6 py-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
             <div className="w-8 h-8 rounded bg-lime-400 flex items-center justify-center text-zinc-950 shadow-[0_0_15px_rgba(163,230,53,0.3)]">
               <Radar size={20} className="animate-[spin_4s_linear_infinite]" />
             </div>
             <div>
               <h1 className="font-bold tracking-tight">Expert 8D Spatializer</h1>
               <p className="text-[10px] text-zinc-500 font-mono tracking-widest uppercase mt-0.5">Multitrack Psychoacoustic Offset Engine</p>
             </div>
          </div>
          <div className="flex items-center gap-2">
             <span className="w-2 h-2 rounded-full bg-lime-500 animate-pulse" />
             <span className="text-xs font-mono text-zinc-400 uppercase tracking-widest leading-none">Auto-Split Matrix Online</span>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        
        {appState !== 'ready' && tracks.length === 0 && (
           <section className="max-w-2xl mx-auto mt-12">
             <FileUpload onFileSelect={handleFileSelect} isLoading={appState === 'analyzing'} />
           </section>
        )}

        {tracks.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            {/* Left/Main Column - Visualizers & Timelines */}
            <div className="lg:col-span-8 xl:col-span-9 space-y-6">
              
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                 <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 flex flex-col justify-between">
                   <span className="text-[10px] font-mono font-bold text-zinc-500 tracking-wider">LOADED STEMS</span>
                   <div className="text-2xl font-bold mt-1 text-lime-400">{tracks.length}</div>
                 </div>
                 <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 flex flex-col justify-between">
                   <span className="text-[10px] font-mono font-bold text-zinc-500 tracking-wider">AUTO-SPATIAL RULES</span>
                   <div className="text-xl font-bold mt-1 uppercase text-zinc-300">Psychoacoustic</div>
                 </div>
                 <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 flex flex-col justify-between">
                   <span className="text-[10px] font-mono font-bold text-zinc-500 tracking-wider">3D ENGINE</span>
                   <div className="text-xl font-bold mt-1 text-zinc-300">True HRTF</div>
                 </div>
                 <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 flex flex-col justify-between">
                   <span className="text-[10px] font-mono font-bold text-zinc-500 tracking-wider">TIMECODE</span>
                   <div className="text-2xl font-bold font-mono mt-1">
                     {formatTime(currentTime)} / {formatTime(duration)}
                   </div>
                 </div>
              </div>

              <SpectrumVisualizer isPlaying={isPlaying} />

              <AutomationTimeline 
                tracks={tracks}
                currentTime={currentTime} 
                duration={duration}
                onSeek={handleSeek} 
              />

              <SpatialHead 
                tracks={tracks}
                currentTime={currentTime}
              />

              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
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
                      onClick={() => { audioEngine.clear(); setTracks([]); }}
                      className="w-12 h-12 flex items-center justify-center rounded-full hover:bg-zinc-800 text-red-400 transition-colors"
                      title="Clear Project"
                    >
                      <Square size={18} fill="currentColor" />
                    </button>
                  </div>
                  
                  {appState !== 'analyzing' ? (
                     <div className="w-1/3">
                       <FileUpload onFileSelect={handleFileSelect} isLoading={false} />
                     </div>
                  ) : (
                     <div className="text-sm font-mono text-lime-400 animate-pulse">Extracting Stems...</div>
                  )}
              </div>

            </div>

            {/* Right Column - Track Mixer */}
            <div className="lg:col-span-4 xl:col-span-3">
               <TrackMixer 
                  tracks={tracks}
                  currentTime={currentTime}
                  onUpdateTrack={handleUpdateTrack}
                  onRemoveTrack={handleRemoveTrack}
                  reverbLevel={reverbLevel}
                  onReverbLevelChange={setReverbLevel}
                  profile={profile}
                  onProfileChange={setProfile}
               />
            </div>
            
          </div>
        )}

      </main>
    </div>
  );
}
