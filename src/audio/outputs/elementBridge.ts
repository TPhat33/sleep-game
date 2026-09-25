import type {
  AudioContextLike,
  AudioOutput,
  GainNodeLike,
  MediaStreamDestinationLike,
} from './AudioOutput';

export interface AudioElementLike {
  srcObject: MediaStream | null;
  play(): Promise<void>;
  pause(): void;
}

/**
 * The fallback strategy (plan §1.8): master -> MediaStreamAudioDestinationNode
 * -> an <audio> element playing that stream. Some platforms keep a *playing
 * media element* alive in the background where a bare AudioContext suspends
 * — the M0 device findings decide whether this is actually needed.
 */
export function createElementBridgeOutput(
  ctx: AudioContextLike,
  createElement: () => AudioElementLike,
): AudioOutput {
  let destination: MediaStreamDestinationLike | null = null;
  let element: AudioElementLike | null = null;

  return {
    kind: 'element-bridge',
    attach(master: GainNodeLike): void {
      destination = ctx.createMediaStreamDestination();
      master.connect(destination);
    },
    async start(): Promise<void> {
      if (!destination) return;
      element = createElement();
      element.srcObject = destination.stream;
      await element.play();
    },
    stop(): void {
      element?.pause();
      element = null;
    },
  };
}
