/// <reference types="vite/client" />

declare const __BUILD_ID__: string;

interface ImportMetaEnv {
  readonly VITE_INCLUDE_SPIKE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

type AudioSessionType =
  'auto' | 'playback' | 'transient' | 'transient-solo' | 'ambient' | 'play-and-record';

interface Navigator {
  readonly audioSession?: { type: AudioSessionType };
  readonly standalone?: boolean;
}
