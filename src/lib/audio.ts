import { Track, SpatialNode, InstrumentType, TrackAnalysis } from '../types';

export class AudioEngine {
  public ctx: AudioContext | null = null;
  public tracks: Track[] = [];
  
  private nodes: Map<string, { source: AudioBufferSourceNode, panner: PannerNode, gain: GainNode }> = new Map();
  
  private masterDry: GainNode | null = null;
  private masterWet: GainNode | null = null;
  private convolver: ConvolverNode | null = null;
  public analyser: AnalyserNode | null = null;

  public startTime: number = 0;
  public pauseOffset: number = 0;
  public isPlaying: boolean = false;

  private onTimeUpdateCallback: ((time: number) => void) | null = null;
  private onEndedCallback: (() => void) | null = null;
  private animFrameId: number | null = null;

  async init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
  }

  async loadAndSplitFile(file: File): Promise<Track[]> {
    await this.init();
    if (!this.ctx) throw new Error('Audio context not initialized');

    const arrayBuffer = await file.arrayBuffer();
    const originalBuffer = await this.ctx.decodeAudioData(arrayBuffer);
    
    const types: InstrumentType[] = ['bass', 'drums', 'vocals', 'other'];
    const newTracks: Track[] = [];

    const promises = types.map(async (type) => {
       const separatedBuffer = await this.createStem(originalBuffer, type);
       const analysis = this.analyzeBuffer(separatedBuffer, type);
       return {
         id: crypto.randomUUID(),
         name: `${file.name.replace(/\.[^/.]+$/, "")} [${type.toUpperCase()}]`,
         buffer: separatedBuffer,
         type,
         analysis,
         isMuted: false,
         isSoloed: false,
         volume: 1.0
       } as Track;
    });

    const results = await Promise.all(promises);
    this.tracks.push(...results);
    return results;
  }

  private async createStem(buffer: AudioBuffer, type: InstrumentType): Promise<AudioBuffer> {
    const offlineCtx = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    const source = offlineCtx.createBufferSource();
    source.buffer = buffer;
    
    // Create a 24dB/oct crossover network by cascading biquad filters
    // This provides much cleaner stem isolation than 12dB/oct standard biquads.
    const createCascade = (type: BiquadFilterType, freq: number, q: number = 0.707) => {
        const f1 = offlineCtx.createBiquadFilter(); f1.type = type; f1.frequency.value = freq; f1.Q.value = q;
        const f2 = offlineCtx.createBiquadFilter(); f2.type = type; f2.frequency.value = freq; f2.Q.value = q;
        f1.connect(f2);
        return { input: f1, output: f2 };
    };

    const gain = offlineCtx.createGain();

    if (type === 'bass') {
      const lp = createCascade('lowpass', 150, 0.5);
      source.connect(lp.input);
      lp.output.connect(gain);
      gain.gain.value = 2.0; 
    } else if (type === 'drums') {
      // Punchy mid-lows and highs, scoop muddy mids
      const hp = createCascade('highpass', 80, 0.5);
      const lp = createCascade('lowpass', 12000, 0.5);
      source.connect(hp.input);
      hp.output.connect(lp.input);
      lp.output.connect(gain);
      gain.gain.value = 1.3;
    } else if (type === 'vocals') {
      // Focus on vocal presence range
      const hp = createCascade('highpass', 300, 0.5);
      const lp = createCascade('lowpass', 4500, 0.5);
      source.connect(hp.input);
      hp.output.connect(lp.input);
      lp.output.connect(gain);
      gain.gain.value = 1.8;
    } else if (type === 'other') {
      // High frequency content, air, synths, cymbals
      const hp = createCascade('highpass', 1000, 0.5);
      source.connect(hp.input);
      hp.output.connect(gain);
      gain.gain.value = 1.5;
    }

    gain.connect(offlineCtx.destination);
    source.start(0);
    return await offlineCtx.startRendering();
  }

  deleteTrack(id: string) {
    this.tracks = this.tracks.filter(t => t.id !== id);
    if (this.isPlaying) {
      const wasPlaying = this.isPlaying;
      this.pause();
      if (wasPlaying) this.play();
    }
  }

  get duration() {
    if (this.tracks.length === 0) return 0;
    return Math.max(...this.tracks.map(t => t.analysis.duration));
  }

  private analyzeBuffer(buffer: AudioBuffer, type: InstrumentType): TrackAnalysis {
    const data = buffer.getChannelData(0);
    const sampleRate = buffer.sampleRate;
    // Increase resolution: analyze every ~50ms for highly fluid spatial automation
    const chunkSize = Math.floor(sampleRate * 0.05); 
    const energies: number[] = [];
    
    let maxRms = 0;
    for (let i = 0; i < data.length; i += chunkSize) {
      let sum = 0;
      const end = Math.min(i + chunkSize, data.length);
      for (let j = i; j < end; j++) {
        sum += data[j] * data[j];
      }
      const rms = Math.sqrt(sum / (end - i));
      energies.push(rms);
      if (rms > maxRms) maxRms = rms;
    }

    // Psychoacoustic smoothing: Human hearing integration time is roughly 200ms.
    // Apply a moving average window to energy to prevent jittery spatial jumps.
    const smoothingWindow = 8; // 8 * 50ms = 400ms smoothing window
    const energyProfile = energies.map((_, i, arr) => {
      let sum = 0, count = 0;
      for (let j = Math.max(0, i - smoothingWindow/2); j < Math.min(arr.length, i + smoothingWindow/2); j++) {
        sum += arr[j]; count++;
      }
      // Apply slight exponential curve to emphasize peaks
      const avg = ((sum / count) / (maxRms || 1));
      return Math.pow(avg, 1.2); 
    });

    const path: SpatialNode[] = [];
    const duration = buffer.duration;
    
    // Smooth LFO state
    let smoothedAngle = 0;
    let smoothedRadius = 0;

    for (let i = 0; i < energyProfile.length; i++) {
      const t = i * (chunkSize / sampleRate);
      const e = energyProfile[i];
      
      let targetX=0, targetY=0, targetZ=0, angle=0, radius=0, elevationAngle=0;

      // ==========================================
      // EXPERT PSYCHOACOUSTIC PLACEMENT RULES
      // ==========================================
      
      if (type === 'bass') {
         // Sub-frequencies are omnidirectional and impossible to localize. 
         // Panning them causes severe phase cancellation and nausea.
         // Action: Hard lock to rigid center, slightly below ear level.
         radius = 0.5; 
         elevationAngle = -0.2; 
         angle = 0; 
      } 
      else if (type === 'drums') {
         // Rhythm backbone. Keep front-stage to maintain groove integrity.
         // Transient-heavy material tears the spatial image if moved too fast.
         radius = 0.8 + (e * 0.2); 
         elevationAngle = 0.1 * e; // Slight height increase on loud hits
         const swayLFO = Math.sin(t * 0.2) * 0.25; 
         angle = swayLFO;
      } 
      else if (type === 'vocals') {
         // Focal point. Human auditory system is highly tuned to vocal localization.
         // Action: Front hemisphere only (+/- 45 deg). Majestic, slow, floating paths.
         radius = 1.0 + (e * 0.2);
         elevationAngle = 0.2 + (e * 0.3); // "Voice of god" subtle lift
         angle = Math.sin(t * 0.4) * 0.6; // Wider sway but strictly front
      } 
      else {
         // Synths/FX: The true 8D experience. Full binaural rotation.
         // Psychoacoustic note: Front-to-back localization requires spectral cues.
         // We boost elevation slightly when passing 'behind' to resolve front-back confusion.
         
         // Speed of rotation accelerates slightly during high energy
         const rotationSpeed = 0.15 + (e * 0.1); 
         smoothedAngle += rotationSpeed * 0.05 * Math.PI * 2; // 0.05s chunk
         angle = smoothedAngle;
         
         radius = 1.2 + (e * 0.6); // Push outside head envelope
         
         // If returning from behind, elevate to help HRTF disambiguate
         const isBehind = Math.cos(angle) < 0;
         elevationAngle = (e * Math.PI/4) + (isBehind ? 0.3 : 0);
      }

      // Smooth interpolations to avoid zippering
      smoothedRadius = smoothedRadius * 0.8 + radius * 0.2;

      // XYZ coordinates for WebAudio HRTF
      // X = Left/Right (Azimuth)
      // Y = Up/Down (Elevation)
      // Z = Front/Back (-Z is front)
      targetX = Math.sin(angle) * Math.cos(elevationAngle) * smoothedRadius;
      targetY = Math.sin(elevationAngle) * smoothedRadius;
      targetZ = -Math.cos(angle) * Math.cos(elevationAngle) * smoothedRadius;

      path.push({ time: t, x: targetX, y: targetY, z: targetZ, energy: e, angle, radius: smoothedRadius, elevationAngle });
    }

    return { peakEnergy: maxRms, energyProfile, path, type, duration };
  }

  private createReverbImpulse(context: AudioContext, duration: number, decay: number) {
    // Generate a realistic 3D room impulse response with Early Reflections
    const sampleRate = context.sampleRate;
    const length = sampleRate * duration;
    const impulse = context.createBuffer(2, length, sampleRate);
    
    // We'll simulate absorption by rolling off highs over time
    for (let c = 0; c < 2; c++) {
      const data = impulse.getChannelData(c);
      let lastVal = 0;
      
      // Psychoacoustic early reflections for spatial 3D cues
      // Slight delay differences between left/right create the "room" feel
      const earlyReflections = [
        { time: c === 0 ? 0.015 : 0.018, amp: 0.6 },
        { time: c === 0 ? 0.032 : 0.028, amp: 0.4 },
        { time: c === 0 ? 0.045 : 0.052, amp: 0.3 },
        { time: c === 0 ? 0.065 : 0.060, amp: 0.2 },
      ];

      for (let i = 0; i < length; i++) {
        const t = i / sampleRate;
        let erVal = 0;
        
        // Add early reflection spikes (simulating wall bounces)
        for (const er of earlyReflections) {
          if (Math.abs(t - er.time) < 0.0005) {
             erVal += er.amp * (Math.random() * 2 - 1);
          }
        }

        // Exponential decay envelope for late reverb
        const envelope = Math.pow(1 - i / length, decay);
        // White noise, heavily decorrelated between channels for extreme width
        const noise = (Math.random() * 2 - 1) * envelope;
        
        // Simple 1-pole lowpass filter that gets darker over time
        // High frequencies absorb faster in air and materials
        const cutoff = Math.max(0.05, 1.0 - (i / length) * 0.95); 
        const filtered = (noise * cutoff) + (lastVal * (1.0 - cutoff));
        lastVal = filtered;
        
        // Add pre-delay gap for late reverb tail (starts around 40ms)
        const lateVal = i > sampleRate * 0.04 ? filtered * 0.4 : 0;
        
        data[i] = erVal + lateVal;
      }
    }
    return impulse;
  }

  setReverbLevel(level: number) {
    if (this.masterWet) {
      this.masterWet.gain.setTargetAtTime(level, this.ctx?.currentTime || 0, 0.1);
    }
  }

  updateMix() {
    if (!this.ctx || !this.isPlaying) return;
    const hasSolo = this.tracks.some(t => t.isSoloed);
    
    for (const t of this.tracks) {
      const node = this.nodes.get(t.id);
      if (node) {
        if (t.isMuted || (hasSolo && !t.isSoloed)) {
          node.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
        } else {
          node.gain.gain.setTargetAtTime(t.volume, this.ctx.currentTime, 0.05);
        }
      }
    }
  }

  setTrackState(tracks: Track[]) {
    this.tracks = tracks;
    this.updateMix();
  }

  private buildGraph() {
    if (!this.ctx || this.tracks.length === 0) return;
    
    this.masterDry = this.ctx.createGain();
    this.masterWet = this.ctx.createGain();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    
    this.convolver = this.ctx.createConvolver();
    this.convolver.buffer = this.createReverbImpulse(this.ctx, 2.5, 4.0);

    // Wire master effects
    this.masterDry.connect(this.analyser);
    this.masterWet.connect(this.analyser);
    this.convolver.connect(this.masterWet);
    this.analyser.connect(this.ctx.destination);
    
    // Balanced wet/dry mix
    this.masterDry.gain.value = 0.85;
    this.masterWet.gain.value = 0.25; 

    // Reset listener
    if (this.ctx.listener) {
      if (this.ctx.listener.positionX) {
        this.ctx.listener.positionX.value = 0;
        this.ctx.listener.positionY.value = 0;
        this.ctx.listener.positionZ.value = 0;
        this.ctx.listener.forwardX.value = 0;
        this.ctx.listener.forwardY.value = 0;
        this.ctx.listener.forwardZ.value = -1;
      } else {
        (this.ctx.listener as any).setPosition(0, 0, 0);
        (this.ctx.listener as any).setOrientation(0, 0, -1, 0, 1, 0);
      }
    }

    this.nodes.clear();
    const hasSolo = this.tracks.some(t => t.isSoloed);

    for (const t of this.tracks) {
      const source = this.ctx.createBufferSource();
      source.buffer = t.buffer;
      
      const panner = this.ctx.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'exponential';
      panner.refDistance = 1;
      panner.maxDistance = 100; // Constrain the distance attenuation
      panner.rolloffFactor = 0.6; // Gentler rolloff for a more cohesive mix
      
      const gain = this.ctx.createGain();
      // Apply initial mute/solo/vol limits
      if (t.isMuted || (hasSolo && !t.isSoloed)) {
         gain.gain.value = 0;
      } else {
         gain.gain.value = t.volume;
      }

      source.connect(gain);
      gain.connect(panner);
      
      panner.connect(this.masterDry);
      
      // We route to reverb if it's not bass to prevent muddy low end
      // We use a high quality 2.5 second tail
      if (t.type !== 'bass') {
         panner.connect(this.convolver);
      }

      this.nodes.set(t.id, { source, panner, gain });

      // Handle end of longest track
      if (t.analysis.duration === this.duration) {
         source.onended = () => {
           if (this.isPlaying) {
             this.pause();
             if (this.onEndedCallback) this.onEndedCallback();
           }
         };
      }
    }
  }

  play() {
    if (!this.ctx || this.tracks.length === 0 || this.isPlaying) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    
    this.buildGraph();
    
    this.startTime = this.ctx.currentTime - this.pauseOffset;
    this.isPlaying = true;

    for (const [id, node] of this.nodes.entries()) {
      const track = this.tracks.find(t => t.id === id);
      if (!track) continue;

      if (this.pauseOffset < track.analysis.duration) {
         node.source.start(0, this.pauseOffset);
         this.schedulePannerAutomation(track, node.panner, this.pauseOffset);
      }
    }

    this.loop();
  }

  private schedulePannerAutomation(track: Track, panner: PannerNode, offset: number) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const path = track.analysis.path;
    const futurePath = path.filter(n => n.time >= offset);
    
    if (futurePath.length > 0) {
       const startNode = futurePath[0];
       panner.positionX.setValueAtTime(startNode.x, now);
       panner.positionY.setValueAtTime(startNode.y, now);
       panner.positionZ.setValueAtTime(startNode.z, now);
       
       for (let i = 1; i < futurePath.length; i++) {
         const node = futurePath[i];
         const scheduleTime = now + (node.time - offset);
         
         // setTargetAtTime creates a much smoother transition (exponential approach)
         // than linearRampToValueAtTime, removing zippering artifacts completely.
         const timeConstant = 0.05; // 50ms smoothing
         panner.positionX.setTargetAtTime(node.x, scheduleTime, timeConstant);
         panner.positionY.setTargetAtTime(node.y, scheduleTime, timeConstant);
         panner.positionZ.setTargetAtTime(node.z, scheduleTime, timeConstant);
       }
    }
  }

  pause() {
    if (!this.isPlaying || !this.ctx) return;
    this.pauseOffset = this.ctx.currentTime - this.startTime;
    
    for (const node of this.nodes.values()) {
      try { node.source.stop(); } catch (e) {}
    }
    
    this.isPlaying = false;
    if (this.animFrameId) cancelAnimationFrame(this.animFrameId);
  }

  seek(time: number) {
    const wasPlaying = this.isPlaying;
    if (this.isPlaying) this.pause();
    this.pauseOffset = Math.max(0, Math.min(time, this.duration));
    if (wasPlaying) this.play();
    
    if (!this.isPlaying && this.onTimeUpdateCallback) {
        this.onTimeUpdateCallback(this.pauseOffset);
    }
  }

  getCurrentTime(): number {
    if (!this.ctx || !this.isPlaying) return this.pauseOffset;
    return this.ctx.currentTime - this.startTime;
  }

  getFrequencyData(array: Uint8Array) {
    if (this.analyser && this.isPlaying) {
      this.analyser.getByteFrequencyData(array);
    } else {
      array.fill(0);
    }
  }

  private loop = () => {
    if (!this.isPlaying) return;
    
    if (this.getCurrentTime() >= this.duration) {
       this.pause();
       this.seek(0);
       if (this.onEndedCallback) this.onEndedCallback();
       return;
    }

    if (this.onTimeUpdateCallback) {
      this.onTimeUpdateCallback(this.getCurrentTime());
    }
    this.animFrameId = requestAnimationFrame(this.loop);
  }

  onTimeUpdate(cb: (t: number) => void) { this.onTimeUpdateCallback = cb; }
  onEnded(cb: () => void) { this.onEndedCallback = cb; }
}

export const audioEngine = new AudioEngine();
