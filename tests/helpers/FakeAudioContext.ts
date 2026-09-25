// Drives AudioContextLike from a FakeClock and records every scheduled
// call, so AudioEngine's pre-scheduled timelines can be asserted on without
// a real AudioContext (plan §4.6).
import type { Clock } from '@/core/clock';
import type {
  AudioContextLike,
  AudioContextState,
  AudioNodeLike,
  AudioParamLike,
  GainNodeLike,
  MediaStreamDestinationLike,
} from '@/audio/outputs/AudioOutput';
import type { AudioBufferSourceNodeLike } from '@/audio/outputs/AudioOutput';

const MS_PER_S = 1000;

export class FakeAudioParam implements AudioParamLike {
  value: number;
  readonly setValueAtTimeCalls: { value: number; time: number }[] = [];
  readonly linearRampCalls: { value: number; time: number }[] = [];
  readonly cancelCalls: number[] = [];

  constructor(initial: number) {
    this.value = initial;
  }

  setValueAtTime(value: number, time: number): void {
    this.value = value;
    this.setValueAtTimeCalls.push({ value, time });
  }

  linearRampToValueAtTime(value: number, time: number): void {
    this.value = value;
    this.linearRampCalls.push({ value, time });
  }

  cancelScheduledValues(time: number): void {
    this.cancelCalls.push(time);
  }
}

class FakeNode implements AudioNodeLike {
  readonly connections: AudioNodeLike[] = [];
  connect(destination: AudioNodeLike): void {
    this.connections.push(destination);
  }
  disconnect(): void {
    this.connections.length = 0;
  }
}

export class FakeGainNode extends FakeNode implements GainNodeLike {
  readonly gain: FakeAudioParam;
  constructor(initial = 1) {
    super();
    this.gain = new FakeAudioParam(initial);
  }
}

export class FakeBufferSourceNode extends FakeNode implements AudioBufferSourceNodeLike {
  buffer: AudioBuffer | null = null;
  loop = false;
  onended: (() => void) | null = null;
  readonly startCalls: number[] = [];
  readonly stopCalls: number[] = [];

  start(when = 0): void {
    this.startCalls.push(when);
  }

  stop(when = 0): void {
    this.stopCalls.push(when);
  }
}

function fakeAudioBuffer(
  numberOfChannels: number,
  length: number,
  sampleRate: number,
): AudioBuffer {
  return {
    numberOfChannels,
    length,
    sampleRate,
    duration: length / sampleRate,
    getChannelData: () => new Float32Array(length),
    copyFromChannel: () => undefined,
    copyToChannel: () => undefined,
  };
}

export class FakeAudioContext implements AudioContextLike {
  state: AudioContextState = 'suspended';
  readonly destination: AudioNodeLike = new FakeNode();
  readonly createdGains: FakeGainNode[] = [];
  readonly createdSources: FakeBufferSourceNode[] = [];

  constructor(private readonly clock: Clock) {}

  get currentTime(): number {
    return this.clock.now() / MS_PER_S;
  }

  resume(): Promise<void> {
    this.state = 'running';
    return Promise.resolve();
  }

  createGain(): GainNodeLike {
    const node = new FakeGainNode(1);
    this.createdGains.push(node);
    return node;
  }

  createBufferSource(): AudioBufferSourceNodeLike {
    const node = new FakeBufferSourceNode();
    this.createdSources.push(node);
    return node;
  }

  createBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBuffer {
    return fakeAudioBuffer(numberOfChannels, length, sampleRate);
  }

  createMediaStreamDestination(): MediaStreamDestinationLike {
    return { stream: {} as MediaStream, connect: () => undefined, disconnect: () => undefined };
  }

  decodeAudioData(): Promise<AudioBuffer> {
    return Promise.resolve(fakeAudioBuffer(1, 1, 44_100));
  }
}

/** A `loadBuffer` deps stub that resolves immediately with a cheap placeholder buffer. */
export function fakeLoadBuffer(): Promise<AudioBuffer> {
  return Promise.resolve(fakeAudioBuffer(1, 1, 44_100));
}

/** Flushes pending microtasks (buffer-load `.then()` chains) so scheduled calls have landed. */
export function flushAsync(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
