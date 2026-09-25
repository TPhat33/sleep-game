import type { AudioContextLike, AudioOutput, GainNodeLike } from './AudioOutput';

/** The default output strategy (plan §1.8): master -> ctx.destination directly. */
export function createWebAudioDirectOutput(ctx: AudioContextLike): AudioOutput {
  return {
    kind: 'webaudio-direct',
    attach(master: GainNodeLike): void {
      master.connect(ctx.destination);
    },
    start(): Promise<void> {
      return Promise.resolve();
    },
    stop(): void {
      // Nothing to release; the node graph is torn down by the engine itself.
    },
  };
}
