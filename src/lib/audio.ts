import { Track, SpatialNode, InstrumentType, TrackAnalysis, HeadphoneProfile } from '../types';

export class AudioEngine {
  public ctx: AudioContext | null = null;
  public tracks: Track[] = [];
  public currentProfile: HeadphoneProfile = 'flat';
  public spatialCalibration: number = 1.0;
  public automationScale: number = 1.0;
  
  private nodes: Map<string, { source: AudioBufferSourceNode, panner: PannerNode, gain: GainNode, autoGain: GainNode }> = new Map();
  
  private masterDry: GainNode | null = null;
  private masterWet: GainNode | null = null;
  private headphoneEQBass: BiquadFilterNode | null = null;
  private headphoneEQTreble: BiquadFilterNode | null = null;
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

    const types: InstrumentType[] = [
      'sub_bass', 'bass', 'kick', 'snare', 'hi_hats',
      'vocals', 'lead', 'strings', 'brass', 'guitar',
      'piano', 'pad', 'synth', 'ambient'
    ];

    const analysisPromises = types.map(async (type) => {
      const separatedBuffer = await this.createStem(originalBuffer, type);
      const analysis = this.analyzeBuffer(separatedBuffer, type, false);
      return { type, buffer: separatedBuffer, analysis };
    });

    const rawResults = await Promise.all(analysisPromises);
    const globalMaxEnergy = Math.max(...rawResults.map(r => r.analysis.peakEnergy), 0.0001);

    const filteredResults = rawResults
      .map((result) => {
        const lowScore = result.analysis.lowEnergies?.reduce((sum, val) => sum + val, 0) ?? 0;
        const highScore = result.analysis.highEnergies?.reduce((sum, val) => sum + val, 0) ?? 0;
        const energyRatio = result.analysis.peakEnergy / globalMaxEnergy;
        const spectrumBalance = (highScore + lowScore) / (result.analysis.energyProfile.length || 1);
        const strength = energyRatio * 0.7 + spectrumBalance * 0.3;
        return { ...result, strength };
      })
      .filter((result) => result.strength >= 0.08)
      .sort((a, b) => b.strength - a.strength)
      .slice(0, 10);

    const tracks = filteredResults.map((result) => ({
      id: crypto.randomUUID(),
      name: `${file.name.replace(/\.[^/.]+$/, "")} [${result.type.toUpperCase()}]`,
      buffer: result.buffer,
      type: result.type,
      analysis: result.analysis,
      isMuted: false,
      isSoloed: false,
      volume: 0.7
    } as Track));

    this.tracks.push(...tracks);
    return tracks;
  }

  private async createStem(buffer: AudioBuffer, type: InstrumentType): Promise<AudioBuffer> {
    const offlineCtx = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    const source = offlineCtx.createBufferSource();
    source.buffer = buffer;
    
    // Create a 24dB/oct crossover network by cascading biquad filters
    const createCascade = (ftype: BiquadFilterType, freq: number, q: number = 0.707) => {
        const f1 = offlineCtx.createBiquadFilter(); f1.type = ftype; f1.frequency.value = freq; f1.Q.value = q;
        const f2 = offlineCtx.createBiquadFilter(); f2.type = ftype; f2.frequency.value = freq; f2.Q.value = q;
        f1.connect(f2);
        return { input: f1, output: f2 };
    };

    const gain = offlineCtx.createGain();

    switch(type) {
      case 'sub_bass':
        // Ultra-low sub frequencies (<50Hz) - omnidirectional, no panning
        const subLp = createCascade('lowpass', 50, 0.5);
        source.connect(subLp.input);
        subLp.output.connect(gain);
        gain.gain.value = 2.5;
        break;
      case 'bass':
        // Bass fundamental (50-150Hz)
        const bassLp = createCascade('lowpass', 150, 0.5);
        source.connect(bassLp.input);
        bassLp.output.connect(gain);
        gain.gain.value = 2.0;
        break;
      case 'kick':
        // Kick drum (30-200Hz with some upper harmonics)
        const kickHp = createCascade('highpass', 30, 0.5);
        const kickLp = createCascade('lowpass', 300, 0.5);
        source.connect(kickHp.input);
        kickHp.output.connect(kickLp.input);
        kickLp.output.connect(gain);
        gain.gain.value = 1.8;
        break;
      case 'snare':
        // Snare (150-4kHz, mid transient percussion)
        const snareHp = createCascade('highpass', 150, 0.5);
        const snareLp = createCascade('lowpass', 4000, 0.5);
        source.connect(snareHp.input);
        snareHp.output.connect(snareLp.input);
        snareLp.output.connect(gain);
        gain.gain.value = 1.6;
        break;
      case 'hi_hats':
        // Hi-hats (2kHz-18kHz, bright transient)
        const hatHp = createCascade('highpass', 2000, 0.5);
        source.connect(hatHp.input);
        hatHp.output.connect(gain);
        gain.gain.value = 1.4;
        break;
      case 'vocals':
      case 'vocals_male':
        // Male vocals (85-255Hz fundamental + harmonics 300-4.5kHz)
        const vocalMaleHp = createCascade('highpass', 300, 0.5);
        const vocalMaleLp = createCascade('lowpass', 4500, 0.5);
        source.connect(vocalMaleHp.input);
        vocalMaleHp.output.connect(vocalMaleLp.input);
        vocalMaleLp.output.connect(gain);
        gain.gain.value = 1.8;
        break;
      case 'vocals_female':
        // Female vocals (165-255Hz fundamental + harmonics 400-5kHz)
        const vocalFemaleHp = createCascade('highpass', 400, 0.5);
        const vocalFemaleLp = createCascade('lowpass', 5000, 0.5);
        source.connect(vocalFemaleHp.input);
        vocalFemaleHp.output.connect(vocalFemaleLp.input);
        vocalFemaleLp.output.connect(gain);
        gain.gain.value = 1.8;
        break;
      case 'lead':
        // Lead melody (400-8kHz, bright solo)
        const leadHp = createCascade('highpass', 400, 0.5);
        const leadLp = createCascade('lowpass', 8000, 0.5);
        source.connect(leadHp.input);
        leadHp.output.connect(leadLp.input);
        leadLp.output.connect(gain);
        gain.gain.value = 1.7;
        break;
      case 'strings':
        // Strings (200-8kHz, smooth sustained)
        const stringHp = createCascade('highpass', 200, 0.5);
        const stringLp = createCascade('lowpass', 8000, 0.5);
        source.connect(stringHp.input);
        stringHp.output.connect(stringLp.input);
        stringLp.output.connect(gain);
        gain.gain.value = 1.6;
        break;
      case 'brass':
        // Brass (300-6kHz, punchy mid-high)
        const brassHp = createCascade('highpass', 300, 0.5);
        const brassLp = createCascade('lowpass', 6000, 0.5);
        source.connect(brassHp.input);
        brassHp.output.connect(brassLp.input);
        brassLp.output.connect(gain);
        gain.gain.value = 1.5;
        break;
      case 'guitar':
        // Guitar (80-8kHz, bright with harmonics)
        const guitarHp = createCascade('highpass', 80, 0.5);
        const guitarLp = createCascade('lowpass', 8000, 0.5);
        source.connect(guitarHp.input);
        guitarHp.output.connect(guitarLp.input);
        guitarLp.output.connect(gain);
        gain.gain.value = 1.6;
        break;
      case 'piano':
        // Piano (27-4kHz, wide range percussive)
        const pianoHp = createCascade('highpass', 27, 0.5);
        const pianoLp = createCascade('lowpass', 4000, 0.5);
        source.connect(pianoHp.input);
        pianoHp.output.connect(pianoLp.input);
        pianoLp.output.connect(gain);
        gain.gain.value = 1.7;
        break;
      case 'pad':
        // Pad (100-8kHz, sustained ethereal)
        const padHp = createCascade('highpass', 100, 0.5);
        const padLp = createCascade('lowpass', 8000, 0.5);
        source.connect(padHp.input);
        padHp.output.connect(padLp.input);
        padLp.output.connect(gain);
        gain.gain.value = 1.5;
        break;
      case 'synth':
        // Synth (200-12kHz, bright variable)
        const synthHp = createCascade('highpass', 200, 0.5);
        const synthLp = createCascade('lowpass', 12000, 0.5);
        source.connect(synthHp.input);
        synthHp.output.connect(synthLp.input);
        synthLp.output.connect(gain);
        gain.gain.value = 1.5;
        break;
      case 'ambient':
      case 'other':
      default:
        // Ambient/FX (full spectrum with emphasis on air)
        const ambientHp = createCascade('highpass', 50, 0.5);
        source.connect(ambientHp.input);
        ambientHp.output.connect(gain);
        gain.gain.value = 1.3;
    }

    gain.connect(offlineCtx.destination);
    source.start(0);
    return await offlineCtx.startRendering();
  }

  deleteTrack(id: string) {
    const nodeInfo = this.nodes.get(id);
    if(nodeInfo) {
      try { nodeInfo.source.stop(); } catch(e){}
      nodeInfo.source.disconnect();
      nodeInfo.autoGain.disconnect();
      nodeInfo.gain.disconnect();
      nodeInfo.panner.disconnect();
      this.nodes.delete(id);
    }
    this.tracks = this.tracks.filter(t => t.id !== id);
    if (this.isPlaying) {
      const wasPlaying = this.isPlaying;
      this.pause();
      if (wasPlaying) this.play();
    }
  }

  clear() {
    this.pause();
    for (const id of Array.from(this.nodes.keys())) {
        this.deleteTrack(id);
    }
    this.tracks = [];
    this.pauseOffset = 0;
    this.startTime = 0;
    if (this.onTimeUpdateCallback) this.onTimeUpdateCallback(0);
  }

  get duration() {
    if (this.tracks.length === 0) return 0;
    return Math.max(...this.tracks.map(t => t.analysis.duration));
  }

  private analyzeBuffer(buffer: AudioBuffer, type: InstrumentType, isMirror: boolean = false): TrackAnalysis {
    const data = buffer.getChannelData(0);
    const sampleRate = buffer.sampleRate;
    // Increase resolution: analyze every ~50ms for highly fluid spatial automation
    const chunkSize = Math.floor(sampleRate * 0.05); 
    const energies: number[] = [];
    const lowEnergies: number[] = [];  // Sub 200Hz
    const highEnergies: number[] = []; // Above 2kHz
    
    let maxRms = 0;
    for (let i = 0; i < data.length; i += chunkSize) {
      let sum = 0;
      let lowSum = 0;
      let highSum = 0;
      const end = Math.min(i + chunkSize, data.length);
      for (let j = i; j < end; j++) {
        const sample = data[j];
        sum += sample * sample;
        // Simple frequency separation via sample pattern
        if ((j - i) % 3 === 0) lowSum += sample * sample;  // Simulate low freq
        if ((j - i) % 2 === 0) highSum += sample * sample; // Simulate high freq
      }
      const rms = Math.sqrt(sum / (end - i));
      const lowRms = Math.sqrt(lowSum / (end - i));
      const highRms = Math.sqrt(highSum / (end - i));
      energies.push(rms);
      lowEnergies.push(lowRms);
      highEnergies.push(highRms);
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
    const lowProfile = lowEnergies.map((_, i, arr) => {
      let sum = 0, count = 0;
      for (let j = Math.max(0, i - smoothingWindow/2); j < Math.min(arr.length, i + smoothingWindow/2); j++) {
        sum += arr[j]; count++;
      }
      return (sum / count) / (maxRms || 1);
    });
    const highProfile = highEnergies.map((_, i, arr) => {
      let sum = 0, count = 0;
      for (let j = Math.max(0, i - smoothingWindow/2); j < Math.min(arr.length, i + smoothingWindow/2); j++) {
        sum += arr[j]; count++;
      }
      return (sum / count) / (maxRms || 1);
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
      // ADVANCED 8D PSYCHOACOUSTIC PLACEMENT RULES
      // Per-instrument spatial automation with multiple orbital paths
      // ==========================================
      
      let orbitType: 'circular' | 'elliptical' | 'figure8' | 'spiral' | 'static' = 'circular';
      let dopplerShift = 0;
      let spinRate = 0;

      // LOWS - Bass & Sub Bass: Omnidirectional, rigid center, no movement
      if (type === 'sub_bass' || type === 'bass') {
        radius = 0.4;
        elevationAngle = -0.15;
        angle = isMirror ? 0.02 : -0.02;
        orbitType = 'static';
        dopplerShift = 0;
      }
      // PERCUSSION: Kick - Low transient, punchy orbital movement
      else if (type === 'kick') {
        const kickEnergy = e;
        radius = 0.5 + (kickEnergy * 0.7);
        elevationAngle = 0.1 + (kickEnergy * 0.3);
        const kickLFO = Math.sin(t * 0.4) * 0.3 + Math.cos(t * 0.2) * 0.15;
        angle = kickLFO * (0.5 + kickEnergy * 0.5);
        orbitType = 'elliptical';
        spinRate = 0.3;
      }
      // PERCUSSION: Snare - Mid transient, wide fast orbit
      else if (type === 'snare') {
        radius = 0.6 + (e * 0.6);
        elevationAngle = 0.2 + (e * 0.4);
        const snareLFO = Math.sin(t * 0.6) * 0.6 + Math.cos(t * 0.3) * 0.2;
        angle = snareLFO + (e * 0.3);
        orbitType = 'figure8';
        spinRate = 0.6;
        dopplerShift = e * 0.3;
      }
      // PERCUSSION: Hi-hats - Bright, sharp orbital sweeps
      else if (type === 'hi_hats') {
        radius = 0.7 + (e * 0.5);
        elevationAngle = 0.3 + (e * 0.5);
        const hatLFO = Math.sin(t * 0.8) * 0.7 + Math.sin(t * 0.4) * 0.3;
        angle = hatLFO;
        orbitType = 'circular';
        spinRate = 0.8;
        dopplerShift = e * 0.2;
      }
      // VOCALS: Focal point floating in space
      else if (type === 'vocals' || type === 'vocals_male' || type === 'vocals_female') {
        radius = 0.75 + (e * 0.45);
        elevationAngle = 0.1 + (e * 0.4) + Math.sin(t * 0.2) * 0.2;
        const vocalAngle = Math.sin(t * 0.25) * 0.6 + Math.cos(t * 0.12) * 0.25;
        angle = vocalAngle * (1 + e * 0.2);
        orbitType = 'elliptical';
        spinRate = 0.25;
        dopplerShift = Math.sin(t * 0.3) * e * 0.15;
      }
      // LEAD: Bright melody with wide spatial sweep
      else if (type === 'lead') {
        const highE = highProfile[i] || e;
        radius = 0.8 + (highE * 0.9);
        elevationAngle = 0.25 + (highE * 0.5);
        const leadLFO = Math.sin(t * 0.4) * 0.8 + Math.cos(t * 0.2) * 0.3;
        angle = leadLFO * (1 + highE * 0.3);
        orbitType = 'spiral';
        spinRate = 0.35 + (highE * 0.25);
        dopplerShift = Math.sin(t * 0.25) * highE * 0.2;
      }
      // STRINGS: Smooth, sustained, wide-stage presence
      else if (type === 'strings') {
        radius = 0.7 + (e * 0.5);
        elevationAngle = 0.05 + (e * 0.3) + Math.sin(t * 0.15) * 0.15;
        const stringAngle = Math.sin(t * 0.18) * 0.8 + Math.cos(t * 0.09) * 0.15;
        angle = stringAngle;
        orbitType = 'elliptical';
        spinRate = 0.18;
      }
      // BRASS: Punchy, explosive, narrow high-energy orbit
      else if (type === 'brass') {
        radius = 0.6 + (e * 0.7);
        elevationAngle = 0.15 + (e * 0.5);
        const brassLFO = Math.sin(t * 0.5) * 0.5 + Math.sin(t * 0.25) * 0.25;
        angle = brassLFO + (e * 0.4);
        orbitType = 'figure8';
        spinRate = 0.5;
        dopplerShift = e * 0.25;
      }
      // GUITAR: Bright with sustain, dynamic orbit
      else if (type === 'guitar') {
        const highE = highProfile[i] || e;
        radius = 0.7 + (highE * 0.6);
        elevationAngle = 0.1 + (highE * 0.4);
        const guitarLFO = Math.sin(t * 0.35) * 0.65 + Math.cos(t * 0.17) * 0.2;
        angle = guitarLFO * (1 + highE * 0.25);
        orbitType = 'elliptical';
        spinRate = 0.3 + (highE * 0.2);
      }
      // PIANO: Wide dynamic range, percussive with sustain
      else if (type === 'piano') {
        const attackFactor = Math.exp(-t * 2) * 0.5; // Fast attack
        radius = 0.6 + (e * 0.6) + (attackFactor * 0.3);
        elevationAngle = 0.0 + (e * 0.4);
        const pianoLFO = Math.sin(t * 0.22) * 0.7 + Math.cos(t * 0.11) * 0.2;
        angle = pianoLFO;
        orbitType = 'circular';
        spinRate = 0.22;
        dopplerShift = Math.sin(t * 0.3) * e * 0.1;
      }
      // PAD: Ethereal, slow, wide atmospheric motion
      else if (type === 'pad') {
        radius = 0.8 + (e * 0.4);
        elevationAngle = 0.2 + (e * 0.25) + Math.sin(t * 0.1) * 0.2;
        const padLFO = Math.sin(t * 0.12) * 0.9 + Math.cos(t * 0.06) * 0.15;
        angle = padLFO;
        orbitType = 'elliptical';
        spinRate = 0.12;
      }
      // SYNTH: Aggressive 8D rotation with frequency-dependent modulation
      else if (type === 'synth') {
        const highE = highProfile[i] || e;
        const lowE = lowProfile[i] || e;
        
        // Highs rotate faster and wider, lows more stable
        const rotationSpeed = 0.25 + (highE * 0.35);
        smoothedAngle += rotationSpeed * 0.05 * Math.PI * 2;
        angle = smoothedAngle;
        
        radius = 0.85 + (lowE * 0.3) + (highE * 1.1);
        elevationAngle = (e * Math.PI / 3.5) + (Math.cos(angle) < 0 ? 0.4 : 0.1);
        
        orbitType = 'spiral';
        spinRate = rotationSpeed;
        dopplerShift = highE * 0.25;
      }
      // AMBIENT/OTHER: Full spatial immersion, complex motion
      else {
        radius = 0.75 + (e * 0.6);
        elevationAngle = Math.sin(t * 0.13) * 0.3 + (e * 0.3);
        const ambientLFO = Math.sin(t * 0.2) * 0.8 + Math.cos(t * 0.1) * 0.3;
        angle = ambientLFO;
        orbitType = 'elliptical';
        spinRate = 0.2;
      }

      if (isMirror && type !== 'sub_bass' && type !== 'bass') {
        angle = -angle;
      }

      // Smooth interpolations to avoid zippering
      smoothedRadius = smoothedRadius * 0.75 + radius * 0.25;

      // XYZ coordinates for WebAudio HRTF
      const depthScale = (1.8 + (e * 0.9)) * this.spatialCalibration;
      const widthScale = (1.2 + (Math.abs(angle) * 0.25)) * (0.9 + this.spatialCalibration * 0.1);
      targetX = Math.sin(angle) * Math.cos(elevationAngle) * smoothedRadius * widthScale;
      targetY = Math.sin(elevationAngle) * smoothedRadius * (0.95 + this.spatialCalibration * 0.05) + 0.25;
      targetZ = -Math.cos(angle) * Math.cos(elevationAngle) * smoothedRadius * depthScale;

      // Calculate dynamic volume with occlusion modeling
      let dynamicVolume = 1.0;
      if (type !== 'sub_bass' && type !== 'bass') {
        const forwardScale = -Math.cos(angle);
        const occlusionDip = Math.max(0, forwardScale) * 0.35;
        dynamicVolume = 1.0 - occlusionDip;
        dynamicVolume *= (0.9 + (e * 0.4));
      }

      path.push({
        time: t,
        x: targetX,
        y: targetY,
        z: targetZ,
        energy: e,
        angle,
        radius: smoothedRadius,
        elevationAngle,
        dynamicVolume,
        lowEnergy: lowProfile[i] || 0,
        highEnergy: highProfile[i] || 0,
        dopplerShift,
        spinRate,
        orbitType
      });
    }

    return {
      peakEnergy: maxRms,
      energyProfile,
      path,
      type,
      duration,
      lowEnergies: lowProfile,
      highEnergies: highProfile,
      spectralCentroid: highEnergies.reduce((a, b) => a + b, 0) / highEnergies.length,
      attackTime: energyProfile.slice(0, Math.min(10, energyProfile.length)).reduce((a, b) => a + b, 0) / Math.min(10, energyProfile.length),
      harmonicContent: highEnergies.length > 0 ? highEnergies.reduce((a, b) => a + b, 0) / highEnergies.length : 0
    };
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

  setProfile(profile: HeadphoneProfile) {
    const changedModel = (this.currentProfile === 'stereo') !== (profile === 'stereo');
    this.currentProfile = profile;
    this.applyProfileEQ();
    // If we changed from HRTF to stereo or vice versa, we must rebuild the graph
    // because panner.panningModel applies at creation.
    if (changedModel && this.isPlaying) {
      this.pause();
      this.play();
    }
  }

  setSpatialCalibration(value: number) {
    this.spatialCalibration = Math.max(0.5, Math.min(1.5, value));
    if (this.isPlaying) {
      this.pause();
      this.play();
    }
  }

  setAutomationScale(value: number) {
    this.automationScale = Math.max(0.6, Math.min(1.6, value));
    if (this.isPlaying) {
      this.pause();
      this.play();
    }
  }

  async playCalibrationTone() {
    await this.init();
    if (!this.ctx) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const panner = this.ctx.createPanner();

    panner.panningModel = this.currentProfile === 'stereo' ? 'equalpower' : 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 0.4;
    panner.maxDistance = 40;
    panner.rolloffFactor = 1.5;
    panner.coneInnerAngle = 45;
    panner.coneOuterAngle = 200;
    panner.coneOuterGain = 0.18;

    const now = this.ctx.currentTime;
    const scale = this.spatialCalibration;
    panner.positionX.setValueAtTime(-1.0 * scale, now);
    panner.positionY.setValueAtTime(0.2 * scale, now);
    panner.positionZ.setValueAtTime(-1.2 * scale, now);
    panner.positionX.linearRampToValueAtTime(1.0 * scale, now + 1.3);
    panner.positionZ.linearRampToValueAtTime(-0.4 * scale, now + 1.3);

    osc.type = 'sine';
    osc.frequency.value = 440;
    gain.gain.value = 0.12;

    osc.connect(gain);
    gain.connect(panner);
    panner.connect(this.ctx.destination);

    return new Promise<void>((resolve) => {
      osc.onended = () => {
        panner.disconnect();
        gain.disconnect();
        resolve();
      };
      osc.start(now);
      osc.stop(now + 1.4);
    });
  }

  private applyProfileEQ() {
    if (!this.headphoneEQBass || !this.headphoneEQTreble) return;
    switch (this.currentProfile) {
        case 'bass_boost':
            this.headphoneEQBass.gain.value = 6;
            this.headphoneEQTreble.gain.value = 0;
            break;
        case 'open_back':
            this.headphoneEQBass.gain.value = -1; // Slight roll-off
            this.headphoneEQTreble.gain.value = 4; // Airy highs
            break;
        case 'flat':
        case 'stereo':
        default:
            this.headphoneEQBass.gain.value = 0;
            this.headphoneEQTreble.gain.value = 0;
            break;
    }
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

  updateTrackPath(trackId: string, path: SpatialNode[]) {
    const track = this.tracks.find((t) => t.id === trackId);
    if (!track) return;
    track.analysis = { ...track.analysis, path };

    if (this.isPlaying) {
      const currentTime = this.getCurrentTime();
      this.pause();
      this.pauseOffset = currentTime;
      this.play();
    }
  }

  private buildGraph() {
    if (!this.ctx || this.tracks.length === 0) return;
    
    this.masterDry = this.ctx.createGain();
    this.masterWet = this.ctx.createGain();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    
    this.headphoneEQBass = this.ctx.createBiquadFilter();
    this.headphoneEQBass.type = 'lowshelf';
    this.headphoneEQBass.frequency.value = 120;
    
    this.headphoneEQTreble = this.ctx.createBiquadFilter();
    this.headphoneEQTreble.type = 'highshelf';
    this.headphoneEQTreble.frequency.value = 8000;
    
    this.applyProfileEQ();
    
    this.convolver = this.ctx.createConvolver();
    this.convolver.buffer = this.createReverbImpulse(this.ctx, 2.5, 4.0);

    // Wire master effects
    this.masterDry.connect(this.headphoneEQBass);
    this.masterWet.connect(this.headphoneEQBass);
    this.headphoneEQBass.connect(this.headphoneEQTreble);
    this.headphoneEQTreble.connect(this.analyser);
    
    this.convolver.connect(this.masterWet);
    this.analyser.connect(this.ctx.destination);
    
    // Balanced wet/dry mix
    this.masterDry.gain.value = 0.75;
    this.masterWet.gain.value = 0.35; 

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
      panner.panningModel = this.currentProfile === 'stereo' ? 'equalpower' : 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = 0.5;
      panner.maxDistance = 30; // Constrain the distance attenuation for more noticeable depth
      panner.rolloffFactor = 1.4; // Stronger depth cues
      panner.coneInnerAngle = 45;
      panner.coneOuterAngle = 200;
      panner.coneOuterGain = 0.18;
      
      const autoGain = this.ctx.createGain();
      autoGain.gain.value = 1.0;
      
      const gain = this.ctx.createGain();
      // Apply initial mute/solo/vol limits
      if (t.isMuted || (hasSolo && !t.isSoloed)) {
         gain.gain.value = 0;
      } else {
         gain.gain.value = t.volume;
      }

      source.connect(autoGain);
      autoGain.connect(gain);
      gain.connect(panner);
      
      panner.connect(this.masterDry);
      
      // We route to reverb if it's not bass to prevent muddy low end
      // We use a high quality 2.5 second tail
      if (t.type !== 'bass') {
         panner.connect(this.convolver);
      }

      this.nodes.set(t.id, { source, panner, gain, autoGain });

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
         this.schedulePannerAutomation(track, node, this.pauseOffset);
      }
    }

    this.loop();
  }

  private schedulePannerAutomation(track: Track, nodeInfo: { panner: PannerNode, autoGain: GainNode }, offset: number) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const path = track.analysis.path;
    const futurePath = path.filter(n => n.time >= offset);
    
    if (futurePath.length > 0) {
       const scale = this.spatialCalibration * this.automationScale;
       const startNode = futurePath[0];
       nodeInfo.panner.positionX.setValueAtTime(startNode.x * scale, now);
       nodeInfo.panner.positionY.setValueAtTime(startNode.y * scale, now);
       nodeInfo.panner.positionZ.setValueAtTime(startNode.z * scale, now);
       nodeInfo.autoGain.gain.setValueAtTime(startNode.dynamicVolume, now);
       
       for (let i = 1; i < futurePath.length; i++) {
         const node = futurePath[i];
         const scheduleTime = now + (node.time - offset);
         
         // setTargetAtTime creates a much smoother transition (exponential approach)
         // than linearRampToValueAtTime, removing zippering artifacts completely.
         const timeConstant = 0.05; // 50ms smoothing
         nodeInfo.panner.positionX.setTargetAtTime(node.x * scale, scheduleTime, timeConstant);
         nodeInfo.panner.positionY.setTargetAtTime(node.y * scale, scheduleTime, timeConstant);
         nodeInfo.panner.positionZ.setTargetAtTime(node.z * scale, scheduleTime, timeConstant);
         nodeInfo.autoGain.gain.setTargetAtTime(node.dynamicVolume, scheduleTime, timeConstant);
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
