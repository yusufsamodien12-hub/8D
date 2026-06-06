/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type InstrumentType = 'vocals' | 'drums' | 'bass' | 'other';

export interface SpatialNode {
  time: number;
  x: number;
  y: number; // Elevation
  z: number; // Front/back
  energy: number;
  angle: number;
  radius: number;
  elevationAngle: number;
}

export interface TrackAnalysis {
  peakEnergy: number;
  energyProfile: number[];
  path: SpatialNode[];
  type: InstrumentType;
  duration: number;
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
