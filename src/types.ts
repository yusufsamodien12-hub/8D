/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type InstrumentType = 
  | 'sub_bass'      // Ultra-low (<50Hz)
  | 'bass'          // Low fundamental (50-150Hz)
  | 'kick'          // Bass drum, low transient
  | 'snare'         // Mid transient percussion
  | 'hi_hats'       // Bright transient percussion
  | 'vocals_male'   // Male vocal range (85-255Hz fundamental)
  | 'vocals_female' // Female vocal range (165-255Hz fundamental)
  | 'vocals'        // Generic vocals
  | 'lead'          // Lead melody, bright solo
  | 'strings'       // Smooth sustained (cello, violin)
  | 'brass'         // Punchy mid-high (trumpet, trombone)
  | 'guitar'        // Bright sustain, harmonics
  | 'piano'         // Wide range, percussive
  | 'pad'           // Sustained, ethereal, atmospheric
  | 'synth'         // Bright variable synthesis
  | 'ambient'       // Atmospheric texture, FX
  | 'other';

export type HeadphoneProfile = 'flat' | 'open_back' | 'bass_boost' | 'stereo';

export interface SpatialNode {
  time: number;
  x: number;
  y: number; // Elevation
  z: number; // Front/back
  energy: number;
  angle: number;
  radius: number;
  elevationAngle: number;
  dynamicVolume: number;
  lowEnergy?: number;   // Sub-200Hz energy
  highEnergy?: number;  // Above-2kHz energy
  dopplerShift?: number; // Simulated distance modulation (-1 to 1)
  spinRate?: number;    // Rotation speed for orbital paths
  orbitType?: 'circular' | 'elliptical' | 'figure8' | 'spiral' | 'static';
}

export interface TrackAnalysis {
  peakEnergy: number;
  energyProfile: number[];
  path: SpatialNode[];
  type: InstrumentType;
  duration: number;
  lowEnergies?: number[];   // Low-freq energy profile
  highEnergies?: number[];  // High-freq energy profile
  spectralCentroid?: number; // Brightness indicator (0-1)
  attackTime?: number;      // Transient duration (0-1)
  harmonicContent?: number; // Harmonic richness (0-1)
  spectralFlux?: number[];  // Rate of spectral change
}

export interface Track {
  id: string;
  name: string;
  buffer: AudioBuffer;
  type: InstrumentType;
  analysis: TrackAnalysis;
  isMuted: boolean;
  isSoloed: boolean;
  volume: number;
}

export interface PlaybackState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
}

export type AppState = 'idle' | 'analyzing' | 'ready';
