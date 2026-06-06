import { AudioAnalysisResult, SpatialNode } from '../types';

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private panner: PannerNode | null = null;
  private convolver: ConvolverNode | null = null;
  private dryGain: GainNode | null = null;
  private wetGain: GainNode | null = null;
  public analyser: AnalyserNode | null = null;
  private _buffer: AudioBuffer | null = null;

  public analysis: AudioAnalysisResult | null = null;
  private startTime: number = 0;
  private pauseOffset: number = 0;
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

  async loadFile(file: File): Promise<AudioBuffer> {
    await this.init();
    if (!this.ctx) throw new Error('Audio context not initialized');

    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
    this._buffer = audioBuffer;
    
    // Analyze and create custom path
    this.analysis = this.analyzeBuffer(audioBuffer);
    return audioBuffer;
  }

  get buffer() {
    return this._buffer;
  }

  private analyzeBuffer(buffer: AudioBuffer): AudioAnalysisResult {
    const data = buffer.getChannelData(0);
    const sampleRate = buffer.sampleRate;
    // Process in ~0.1s chunks for fast analysis without blocking
    const chunkSize = Math.floor(sampleRate / 10); 
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

    // Normalize and smooth
    const energyProfile = energies.map((e, i, arr) => {
      let sum = 0;
      let count = 0;
      for (let j = Math.max(0, i - 2); j < Math.min(arr.length, i + 3); j++) {
        sum += arr[j];
        count++;
      }
      return (sum / count) / (maxRms || 1);
    });

    // Simple peak detection for BPM estimation
    let peaks = [];
    const threshold = 0.5;
    for (let i = 1; i < energyProfile.length - 1; i++) {
       if (energyProfile[i] > threshold && 
           energyProfile[i] > energyProfile[i - 1] && 
           energyProfile[i] > energyProfile[i + 1]) {
          peaks.push(i);
       }
    }

    let bpm = 120;
    if (peaks.length > 2) {
      const intervals = [];
      for (let i = 1; i < peaks.length; i++) {
        intervals.push((peaks[i] - peaks[i-1]) * (chunkSize / sampleRate));
      }
      const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      if (avgInterval > 0) {
        bpm = Math.round(60 / avgInterval);
        while (bpm < 70) bpm *= 2;
        while (bpm > 180) bpm /= 2;
      }
    }

    // Generate Path
    const path: SpatialNode[] = [];
    const duration = buffer.duration;
    const beatDuration = 60 / bpm;
    const barDuration = beatDuration * 4;

    for (let i = 0; i < energyProfile.length; i++) {
      const t = i * (chunkSize / sampleRate);
      const e = energyProfile[i];
      
      // Rotational speed correlates with energy. 
      // Higher energy = faster orbit (2 bars). Low energy = slower orbit (4 bars).
      const revolutions = t / (barDuration * (e > 0.6 ? 2 : 4));
      const angle = revolutions * Math.PI * 2;
      
      // Radius modulates slightly - pushes further away for a wider stage during drops
      const radius = 1.0 + (e * 0.8);
      
      // Elevation (height). High energy pushes into the "Height Layer" (up to 45 deg)
      // Slight LFO on top to make it float
      const elevationAngle = (e * (Math.PI / 4)) + (Math.sin(revolutions * Math.PI) * 0.1);
      
      // Web Audio Coordinates: +X (Right), +Y (Up), +Z (Back)
      // We want the sound to orbit the listener (0,0,0) looking (-Z)
      const x = Math.sin(angle) * Math.cos(elevationAngle) * radius;
      const y = Math.sin(elevationAngle) * radius;
      const z = -Math.cos(angle) * Math.cos(elevationAngle) * radius;

      path.push({
        time: t,
        x, y, z,
        energy: e,
        angle,
        radius,
        elevationAngle
      });
    }

    return {
      bpm,
      peakEnergy: maxRms,
      energyProfile,
      path,
      duration
    };
  }

  // Very simplistic synthesized reverb impulse response
  private createReverbImpulse(context: AudioContext, duration: number, decay: number) {
    const sampleRate = context.sampleRate;
    const length = sampleRate * duration;
    const impulse = context.createBuffer(2, length, sampleRate);
    for (let c = 0; c < 2; c++) {
      const data = impulse.getChannelData(c);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
      }
    }
    return impulse;
  }

  private buildGraph() {
    if (!this.ctx || !this._buffer) return;
    
    this.source = this.ctx.createBufferSource();
    this.source.buffer = this._buffer;
    
    this.panner = this.ctx.createPanner();
    this.panner.panningModel = 'HRTF'; // Exact true 3D
    this.panner.distanceModel = 'inverse';
    this.panner.refDistance = 1;
    this.panner.maxDistance = 10000;
    this.panner.rolloffFactor = 1;

    // Reset listener to origin looking forward
    if (this.ctx.listener) {
      if (this.ctx.listener.positionX) {
        this.ctx.listener.positionX.value = 0;
        this.ctx.listener.positionY.value = 0;
        this.ctx.listener.positionZ.value = 0;
        this.ctx.listener.forwardX.value = 0;
        this.ctx.listener.forwardY.value = 0;
        this.ctx.listener.forwardZ.value = -1;
      } else {
        // Fallback for older browsers
        (this.ctx.listener as any).setPosition(0, 0, 0);
        (this.ctx.listener as any).setOrientation(0, 0, -1, 0, 1, 0);
      }
    }

    this.convolver = this.ctx.createConvolver();
    this.convolver.buffer = this.createReverbImpulse(this.ctx, 2.0, 3.0);
    
    this.dryGain = this.ctx.createGain();
    this.wetGain = this.ctx.createGain();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    
    // Wire up
    this.source.connect(this.analyser);
    this.analyser.connect(this.panner);
    
    // Split panner output to dry and wet
    this.panner.connect(this.dryGain);
    this.panner.connect(this.convolver);
    this.convolver.connect(this.wetGain);
    
    this.dryGain.connect(this.ctx.destination);
    this.wetGain.connect(this.ctx.destination);

    // Initial mix
    this.dryGain.gain.value = 0.8;
    this.wetGain.gain.value = 0.3; // spacious reverb feel

    this.source.onended = () => {
      if (this.isPlaying) {
        this.pause();
        if (this.onEndedCallback) this.onEndedCallback();
      }
    };
  }

  play() {
    if (!this.ctx || !this._buffer || this.isPlaying) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    
    this.buildGraph();
    
    if (this.source) {
      const offset = this.pauseOffset % this._buffer.duration;
      this.source.start(0, offset);
      this.startTime = this.ctx.currentTime - offset;
      this.isPlaying = true;
      
      this.schedulePannerAutomation(offset);
      this.loop();
    }
  }

  private schedulePannerAutomation(offset: number) {
    if (!this.panner || !this.analysis || !this.ctx) return;
    const now = this.ctx.currentTime;
    
    // Web audio scheduling helps keep it perfectly clean
    // We queue up points from current offset onwards
    const { path } = this.analysis;
    const futurePath = path.filter(n => n.time >= offset);
    
    // Reset to start state
    if (futurePath.length > 0) {
       const startNode = futurePath[0];
       this.panner.positionX.setValueAtTime(startNode.x, now);
       this.panner.positionY.setValueAtTime(startNode.y, now);
       this.panner.positionZ.setValueAtTime(startNode.z, now);
       
       for (let i = 1; i < futurePath.length; i++) {
         const node = futurePath[i];
         const scheduleTime = now + (node.time - offset);
         this.panner.positionX.linearRampToValueAtTime(node.x, scheduleTime);
         // Adding slightly exaggerated height to be audible via HRTF
         this.panner.positionY.linearRampToValueAtTime(node.y * 1.5, scheduleTime);
         this.panner.positionZ.linearRampToValueAtTime(node.z, scheduleTime);
         
         // Increase reverb wetness as it goes higher/further for spatial scale
         if (this.wetGain && this.dryGain) {
            const wetMix = 0.2 + (node.energy * 0.3);
            this.wetGain.gain.linearRampToValueAtTime(wetMix, scheduleTime);
            this.dryGain.gain.linearRampToValueAtTime(1 - (wetMix * 0.5), scheduleTime);
         }
       }
    }
  }

  pause() {
    if (!this.isPlaying || !this.ctx || !this.source) return;
    
    this.pauseOffset = this.ctx.currentTime - this.startTime;
    try {
      this.source.stop();
    } catch (e) {}
    this.isPlaying = false;
    
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
    }
  }

  seek(time: number) {
    const wasPlaying = this.isPlaying;
    if (this.isPlaying) this.pause();
    this.pauseOffset = Math.max(0, Math.min(time, this._buffer ? this._buffer.duration : 0));
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
    if (this.onTimeUpdateCallback) {
      this.onTimeUpdateCallback(this.getCurrentTime());
    }
    this.animFrameId = requestAnimationFrame(this.loop);
  }

  onTimeUpdate(cb: (t: number) => void) {
    this.onTimeUpdateCallback = cb;
  }

  onEnded(cb: () => void) {
    this.onEndedCallback = cb;
  }
}

export const audioEngine = new AudioEngine();
