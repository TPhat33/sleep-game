// The minimal structural subset of the Web Audio API AudioEngine needs —
// plan §1.8/§4.6. Real Web Audio nodes already satisfy these shapes (a
// structural superset), so the real adapter needs no runtime wrapping;
// tests/helpers/FakeAudioContext.ts implements them directly, driven by a
// FakeClock, so timeline assertions don't need a real AudioContext.

import type { AudioOutputKind } from '../../core/types';

export type { AudioOutputKind };

export interface AudioParamLike {
  value: number;
  setValueAtTime(value: number, startTime: number): void;
  linearRampToValueAtTime(value: number, endTime: number): void;
  cancelScheduledValues(startTime: number): void;
}

export interface AudioNodeLike {
  connect(destination: AudioNodeLike): void;
  disconnect(): void;
}

export interface GainNodeLike extends AudioNodeLike {
  readonly gain: AudioParamLike;
}

export interface AudioBufferSourceNodeLike extends AudioNodeLike {
  buffer: AudioBuffer | null;
  loop: boolean;
  onended: (() => void) | null;
  start(when?: number): void;
  stop(when?: number): void;
}

export interface MediaStreamDestinationLike extends AudioNodeLike {
  readonly stream: MediaStream;
}

export type AudioContextState = 'suspended' | 'running' | 'closed';

export interface AudioContextLike {
  readonly currentTime: number;
  readonly state: AudioContextState;
  readonly destination: AudioNodeLike;
  resume(): Promise<void>;
  createGain(): GainNodeLike;
  createBufferSource(): AudioBufferSourceNodeLike;
  createBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBuffer;
  createMediaStreamDestination(): MediaStreamDestinationLike;
  decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer>;
}

export interface AudioOutput {
  readonly kind: AudioOutputKind;
  /** Connects the master node to the actual sink. */
  attach(master: GainNodeLike): void;
  /** Must be called inside a user gesture the first time. */
  start(): Promise<void>;
  stop(): void;
}
