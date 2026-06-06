import { Track } from '../types';

async function loadLameJsGlobalScript() {
  if (typeof window !== 'undefined' && (window as any).lamejs?.Mp3Encoder) {
    return (window as any).lamejs;
  }

  const rawModule = await import('lamejs/lame.all.js?raw');
  const scriptSource = typeof rawModule === 'string' ? rawModule : rawModule.default;

  if (!scriptSource) {
    throw new Error('Unable to load lamejs browser script source');
  }

  if (typeof document !== 'undefined') {
    const script = document.createElement('script');
    script.textContent = scriptSource;
    document.head.appendChild(script);
    document.head.removeChild(script);
  } else if (typeof globalThis !== 'undefined' && typeof globalThis.eval === 'function') {
    (0, globalThis.eval)(scriptSource);
  } else {
    eval(scriptSource);
  }

  const lameGlobal = typeof window !== 'undefined' ? (window as any).lamejs : undefined;
  if (!lameGlobal?.Mp3Encoder) {
    throw new Error('Global lamejs initialization failed');
  }

  return lameGlobal;
}

async function getMp3EncoderConstructor() {
  const lameGlobal = await loadLameJsGlobalScript();
  return lameGlobal.Mp3Encoder;
}

function createSimpleImpulse(context: OfflineAudioContext, duration = 1.5, decay = 3.0) {
  const sampleRate = context.sampleRate;
  const length = Math.floor(sampleRate * duration);
  const impulse = context.createBuffer(2, length, sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t / duration, decay);
    }
  }
  return impulse;
}

function normalizeAndLimitAudioBuffer(buffer: AudioBuffer, peakTarget = 0.96) {
  const numChannels = buffer.numberOfChannels;
  const length = buffer.length;
  let maxSample = 0;

  for (let ch = 0; ch < numChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      maxSample = Math.max(maxSample, Math.abs(data[i]));
    }
  }

  const gain = maxSample > 0 ? Math.min(1, peakTarget / maxSample) : 1;
  const threshold = 0.98;
  const headroom = 1 - threshold;

  const output = new AudioBuffer({ length, numberOfChannels: numChannels, sampleRate: buffer.sampleRate });

  for (let ch = 0; ch < numChannels; ch++) {
    const input = buffer.getChannelData(ch);
    const outputData = output.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      let sample = input[i] * gain;
      const abs = Math.abs(sample);
      if (abs > threshold) {
        const exceeded = abs - threshold;
        const compressed = threshold + headroom * (1 - Math.exp(-exceeded / headroom));
        sample = Math.sign(sample) * Math.min(compressed, 1);
      }
      outputData[i] = sample;
    }
  }

  return output;
}

function floatTo16BitPCM(float32Array: Float32Array) {
  const output = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    output[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return output;
}

function audioBufferToWav(buffer: AudioBuffer) {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;

  const result = interleaveAndEncode(buffer, numChannels, sampleRate, bitDepth, format);
  return new Blob([result], { type: 'audio/wav' });
}

async function audioBufferToMp3(buffer: AudioBuffer, bitRate = 192) {
  let Mp3EncoderConstructor = await getMp3EncoderConstructor();
  if (!Mp3EncoderConstructor) {
    throw new Error('MP3 encoder unavailable: lamejs could not be loaded');
  }

  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const leftChannel = floatTo16BitPCM(buffer.getChannelData(0));
  const rightChannel = numChannels > 1 ? floatTo16BitPCM(buffer.getChannelData(1)) : leftChannel;

  let encoder;
  try {
    encoder = new Mp3EncoderConstructor(numChannels, sampleRate, bitRate);
  } catch (initialError) {
    console.warn('Mp3Encoder constructor failed, retrying with global lamejs script loader', initialError);
    Mp3EncoderConstructor = (await loadLameJsGlobalScript()).Mp3Encoder;
    encoder = new Mp3EncoderConstructor(numChannels, sampleRate, bitRate);
  }
  const mp3Chunks: Uint8Array[] = [];
  const samplesPerFrame = 1152;

  for (let i = 0; i < leftChannel.length; i += samplesPerFrame) {
    const leftChunk = leftChannel.subarray(i, i + samplesPerFrame);
    const rightChunk = rightChannel.subarray(i, i + samplesPerFrame);
    const mp3buf = encoder.encodeBuffer(leftChunk, rightChunk);
    if (mp3buf.length > 0) {
      mp3Chunks.push(new Uint8Array(mp3buf));
    }
  }

  const flushBuf = encoder.flush();
  if (flushBuf.length > 0) mp3Chunks.push(new Uint8Array(flushBuf));

  return new Blob(mp3Chunks, { type: 'audio/mpeg' });
}

function interleaveAndEncode(buffer: AudioBuffer, numChannels: number, sampleRate: number, bitDepth: number, format: number) {
  const samples = buffer.length;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const bufferLength = 44 + samples * blockAlign;
  const view = new DataView(new ArrayBuffer(bufferLength));

  /* RIFF identifier */ writeString(view, 0, 'RIFF');
  /* file length */ view.setUint32(4, 36 + samples * blockAlign, true);
  /* RIFF type */ writeString(view, 8, 'WAVE');
  /* format chunk identifier */ writeString(view, 12, 'fmt ');
  /* format chunk length */ view.setUint32(16, 16, true);
  /* sample format (raw) */ view.setUint16(20, format, true);
  /* channel count */ view.setUint16(22, numChannels, true);
  /* sample rate */ view.setUint32(24, sampleRate, true);
  /* byte rate (sample rate * block align) */ view.setUint32(28, sampleRate * blockAlign, true);
  /* block align (channel count * bytes per sample) */ view.setUint16(32, blockAlign, true);
  /* bits per sample */ view.setUint16(34, bitDepth, true);
  /* data chunk identifier */ writeString(view, 36, 'data');
  /* data chunk length */ view.setUint32(40, samples * blockAlign, true);

  let offset = 44;
  const channelData: Float32Array[] = [];
  for (let ch = 0; ch < numChannels; ch++) channelData.push(buffer.getChannelData(ch));

  for (let i = 0; i < samples; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channelData[ch][i] || 0));
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
  }

  return view;
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

function interpolateSpatialNode(path: { time: number; dynamicVolume: number; x: number }[], time: number) {
  if (!path || path.length === 0) {
    return { dynamicVolume: 1, x: 0 };
  }

  if (time <= path[0].time) {
    return { dynamicVolume: path[0].dynamicVolume, x: path[0].x };
  }

  if (time >= path[path.length - 1].time) {
    return { dynamicVolume: path[path.length - 1].dynamicVolume, x: path[path.length - 1].x };
  }

  let left = 0;
  while (left < path.length - 1 && path[left + 1].time < time) {
    left += 1;
  }

  const a = path[left];
  const b = path[left + 1];
  const t = (time - a.time) / Math.max(b.time - a.time, 1e-6);

  return {
    dynamicVolume: a.dynamicVolume + (b.dynamicVolume - a.dynamicVolume) * t,
    x: a.x + (b.x - a.x) * t,
  };
}

function panToStereo(x: number) {
  const clamped = Math.max(-1, Math.min(1, x));
  const angle = (clamped + 1) * 0.25 * Math.PI;
  return {
    left: Math.cos(angle),
    right: Math.sin(angle),
  };
}

async function renderMixToAudioBuffer(tracks: Track[], sampleRate = 44100) {
  if (!tracks || tracks.length === 0) throw new Error('No tracks to export');

  const maxDuration = Math.max(...tracks.map(t => t.analysis.duration));
  const length = Math.ceil(maxDuration * sampleRate);
  const output = new AudioBuffer({ length, numberOfChannels: 2, sampleRate });
  const outputLeft = output.getChannelData(0);
  const outputRight = output.getChannelData(1);

  for (const track of tracks) {
    const buffer = track.buffer as AudioBuffer;
    const trackLength = buffer.length;
    const trackLeft = buffer.getChannelData(0);
    const trackRight = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : trackLeft;

    for (let sampleIndex = 0; sampleIndex < trackLength; sampleIndex++) {
      const time = sampleIndex / sampleRate;
      const { dynamicVolume, x } = interpolateSpatialNode(track.analysis.path, time);
      const { left: panLeft, right: panRight } = panToStereo(x);
      const gain = track.volume * dynamicVolume;

      const sourceMono = 0.5 * (trackLeft[sampleIndex] + trackRight[sampleIndex]);
      const value = sourceMono * gain;

      outputLeft[sampleIndex] += value * panLeft;
      outputRight[sampleIndex] += value * panRight;
    }
  }

  return normalizeAndLimitAudioBuffer(output);
}

export async function exportMixToWav(tracks: Track[], sampleRate = 44100): Promise<Blob> {
  const rendered = await renderMixToAudioBuffer(tracks, sampleRate);
  return audioBufferToWav(rendered);
}

export async function exportMixToMp3(tracks: Track[], sampleRate = 44100, bitRate = 192): Promise<Blob> {
  const rendered = await renderMixToAudioBuffer(tracks, sampleRate);
  return audioBufferToMp3(rendered, bitRate);
}

export default exportMixToWav;
