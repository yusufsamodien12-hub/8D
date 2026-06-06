/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

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

export interface AudioAnalysisResult {
  bpm: number;
  peakEnergy: number;
  energyProfile: number[];
  path: SpatialNode[];
  duration: number;
}

export interface PlaybackState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
}

export type AppState = 'idle' | 'analyzing' | 'ready';
