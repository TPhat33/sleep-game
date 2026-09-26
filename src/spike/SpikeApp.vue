<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue';

import { CONFIG } from '../core/config';
import { createPlatform } from '../platform';
import type { Platform } from '../platform/Platform';
import { AudioLab } from './audioLab';
import type { AudioLabSnapshot, BrownNoiseMode, LayerId, Strategy } from './audioLab';
import { diagLog } from './diagLog';
import type { LogEntry } from './diagLog';
import { Heartbeat } from './heartbeat';

const READOUT_REFRESH_MS = 500;

const buildId = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';

const platform = ref<Platform | null>(null);
const platformError = ref<string | null>(null);

const audioLab = new AudioLab();
const heartbeat = new Heartbeat();

const strategy = ref<Strategy>('webaudio-direct');
const layers = reactive<Record<LayerId, boolean>>({ brownNoise: true, rain: true, marker: true });
const brownNoiseMode = ref<BrownNoiseMode>('buffer');
const mediaSessionEnabled = ref(true);
const audioSessionEnabled = ref(true);
const backgroundAudioActive = ref(false);
const masterVolume = ref(1);
const unlocked = ref(false);
const assetsLoaded = ref(false);

const snapshot = ref<AudioLabSnapshot>(audioLab.snapshot());

const hiddenAt = ref<{ wall: number; ctxTime: number } | null>(null);
const continuityReport = ref<string>('(not measured yet — background the tab, then return)');

const brightnessSupported = ref(false);
const brightnessValue = ref<number | null>(null);
const brightnessSlider = ref(CONFIG.pacing.BRIGHTNESS_MIN);

const wakeLockSupported = ref(false);
const wakeLockHeld = ref(false);

const userAgent = navigator.userAgent;
const hasAudioSession = 'audioSession' in navigator;
const hasMediaSession = 'mediaSession' in navigator;
const visibilityState = ref(document.visibilityState);

const logEntries = ref<readonly LogEntry[]>(diagLog.getAll());
const heartbeatGap = ref(0);

let readoutTimer: ReturnType<typeof setInterval> | null = null;
let unsubscribeLog: (() => void) | null = null;

function refreshSnapshot(): void {
  snapshot.value = audioLab.snapshot();
  if (platform.value) {
    wakeLockHeld.value = platform.value.wakeLock.held;
  }
  heartbeatGap.value = heartbeat.maxGapSince(Date.now() - 60_000);
}

async function initPlatform(): Promise<void> {
  try {
    platform.value = await createPlatform({
      log: (msg) => {
        diagLog.log('platform', msg);
      },
    });
    brightnessSupported.value = platform.value.brightness.supported;
    wakeLockSupported.value = platform.value.wakeLock.supported;
    diagLog.log(
      'platform',
      `initialized: kind=${platform.value.info.kind} isNative=${String(platform.value.info.isNative)}`,
    );
  } catch (err) {
    platformError.value = String(err);
    diagLog.log('platform', `init failed: ${String(err)}`);
  }
}

onMounted(() => {
  void initPlatform();
  heartbeat.start();
  unsubscribeLog = diagLog.onChange((entries) => {
    logEntries.value = entries;
  });
  document.addEventListener('visibilitychange', onVisibilityChange);
  readoutTimer = setInterval(refreshSnapshot, READOUT_REFRESH_MS);
});

onBeforeUnmount(() => {
  heartbeat.stop();
  unsubscribeLog?.();
  document.removeEventListener('visibilitychange', onVisibilityChange);
  if (readoutTimer !== null) clearInterval(readoutTimer);
});

function onVisibilityChange(): void {
  visibilityState.value = document.visibilityState;
  diagLog.log('lifecycle', `visibilitychange: ${document.visibilityState}`);
  if (document.visibilityState === 'hidden') {
    const ctxTime = audioLab.getCtxCurrentTime();
    if (ctxTime !== null) {
      hiddenAt.value = { wall: Date.now(), ctxTime };
    }
  } else if (hiddenAt.value) {
    const hiddenForMs = Date.now() - hiddenAt.value.wall;
    const ctxTime = audioLab.getCtxCurrentTime();
    const audioAdvancedMs = ctxTime !== null ? (ctxTime - hiddenAt.value.ctxTime) * 1000 : 0;
    const continuityPct = hiddenForMs > 0 ? (audioAdvancedMs / hiddenForMs) * 100 : 0;
    continuityReport.value = `hidden for ${(hiddenForMs / 1000).toFixed(1)}s, audio advanced ${(audioAdvancedMs / 1000).toFixed(1)}s, continuity ${continuityPct.toFixed(0)}%`;
    diagLog.log('ctx', `continuity: ${continuityReport.value}`);
    hiddenAt.value = null;
  }
}

async function onUnlock(): Promise<void> {
  await audioLab.unlock();
  unlocked.value = true;
  await audioLab.loadAssets();
  assetsLoaded.value = true;
  refreshSnapshot();
}

function onStrategyChange(): void {
  audioLab.setStrategy(strategy.value);
}

function onLayerToggle(layer: LayerId): void {
  audioLab.setLayer(layer, layers[layer]);
}

function onBrownNoiseModeChange(): void {
  audioLab.setBrownNoiseMode(brownNoiseMode.value);
}

async function onToggleBackgroundAudio(): Promise<void> {
  if (!platform.value) return;
  if (backgroundAudioActive.value) {
    await platform.value.backgroundAudio.activate({ title: 'Hushglow — spike' });
  } else {
    await platform.value.backgroundAudio.deactivate();
  }
}

function onPlay(): void {
  audioLab.play();
  refreshSnapshot();
}

function onStop(): void {
  audioLab.stop();
  refreshSnapshot();
}

function onVolumeChange(): void {
  audioLab.setMasterVolume(masterVolume.value);
}

function onFade(minutes: number): void {
  audioLab.fadeToSilence(minutes);
}

function onScheduleBlips(): void {
  audioLab.scheduleBlips(10, 45);
}

function onStartPreset(): void {
  strategy.value = 'webaudio-direct';
  audioLab.setStrategy('webaudio-direct');
  layers.brownNoise = true;
  layers.rain = true;
  layers.marker = true;
  mediaSessionEnabled.value = true;
  audioSessionEnabled.value = true;
  backgroundAudioActive.value = true;
  void onToggleBackgroundAudio();
  onPlay();
  diagLog.log('ctx', 'preset applied (A1 configuration)');
}

async function onReadBrightness(): Promise<void> {
  if (!platform.value) return;
  brightnessValue.value = await platform.value.brightness.get();
}

async function onSetBrightness(level: number): Promise<void> {
  if (!platform.value) return;
  await platform.value.brightness.set(level);
  await onReadBrightness();
}

async function onRestoreBrightness(): Promise<void> {
  if (!platform.value) return;
  await platform.value.brightness.restore();
  await onReadBrightness();
}

async function onAcquireWakeLock(): Promise<void> {
  if (!platform.value) return;
  await platform.value.wakeLock.acquire();
  wakeLockHeld.value = platform.value.wakeLock.held;
}

async function onReleaseWakeLock(): Promise<void> {
  if (!platform.value) return;
  await platform.value.wakeLock.release();
  wakeLockHeld.value = platform.value.wakeLock.held;
}

async function onCopyLog(): Promise<void> {
  try {
    await navigator.clipboard.writeText(diagLog.formatAll());
    diagLog.log('platform', 'log copied to clipboard');
  } catch (err) {
    diagLog.log('platform', `copy failed: ${String(err)}`);
  }
}

function onExportLog(): void {
  const text = diagLog.formatAll();
  try {
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `spike-log-${buildId}-${String(Date.now())}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    diagLog.log('platform', `export failed, falling back to textarea: ${String(err)}`);
  }
}

function onClearLog(): void {
  diagLog.clear();
}
</script>

<template>
  <main class="spike">
    <h1>Hushglow — Platform Spike</h1>

    <section class="panel">
      <h2>Info</h2>
      <p>build: {{ buildId }}</p>
      <p v-if="platform">
        platform: {{ platform.info.kind }} · isNative: {{ platform.info.isNative }} · standalonePwa:
        {{ platform.info.isStandalonePwa }}
      </p>
      <p v-else-if="platformError">platform init failed: {{ platformError }}</p>
      <p v-else>platform: loading…</p>
      <p>userAgent: {{ platform?.info.userAgent ?? userAgent }}</p>
      <p>brightness.supported: {{ brightnessSupported }}</p>
      <p>wakeLock.supported: {{ wakeLockSupported }}</p>
      <p>backgroundAudio.mode: {{ platform?.backgroundAudio.mode ?? '(loading)' }}</p>
      <p>navigator.audioSession present: {{ hasAudioSession }}</p>
      <p>navigator.mediaSession present: {{ hasMediaSession }}</p>
      <p>document.visibilityState: {{ visibilityState }}</p>
    </section>

    <section class="panel">
      <h2>Audio lab</h2>
      <button @click="onUnlock">Unlock audio</button>
      <p>unlocked: {{ unlocked }} · assets loaded: {{ assetsLoaded }}</p>

      <fieldset>
        <legend>Strategy</legend>
        <label
          ><input
            v-model="strategy"
            type="radio"
            value="webaudio-direct"
            @change="onStrategyChange"
          />
          webaudio-direct</label
        >
        <label
          ><input
            v-model="strategy"
            type="radio"
            value="element-bridge"
            @change="onStrategyChange"
          />
          element-bridge</label
        >
        <label
          ><input
            v-model="strategy"
            type="radio"
            value="element-files"
            @change="onStrategyChange"
          />
          element-files (baseline)</label
        >
      </fieldset>

      <fieldset>
        <legend>Layers</legend>
        <label
          ><input
            v-model="layers.brownNoise"
            type="checkbox"
            @change="onLayerToggle('brownNoise')"
          />
          brown noise</label
        >
        <select v-model="brownNoiseMode" @change="onBrownNoiseModeChange">
          <option value="buffer">buffer</option>
          <option value="worklet">worklet</option>
        </select>
        <label
          ><input v-model="layers.rain" type="checkbox" @change="onLayerToggle('rain')" /> rain
          loop</label
        >
        <label
          ><input v-model="layers.marker" type="checkbox" @change="onLayerToggle('marker')" />
          marker chime every 60s</label
        >
      </fieldset>

      <fieldset>
        <legend>Toggles</legend>
        <label><input v-model="mediaSessionEnabled" type="checkbox" /> MediaSession metadata</label>
        <label
          ><input v-model="audioSessionEnabled" type="checkbox" /> audioSession.type=playback</label
        >
        <label
          ><input
            v-model="backgroundAudioActive"
            type="checkbox"
            @change="onToggleBackgroundAudio"
          />
          Activate background audio</label
        >
      </fieldset>

      <button @click="onPlay">Play</button>
      <button @click="onStop">Stop</button>
      <label
        >master volume
        <input
          v-model.number="masterVolume"
          type="range"
          min="0"
          max="1"
          step="0.01"
          @input="onVolumeChange"
      /></label>

      <div>
        <span>Fade to silence over:</span>
        <button @click="onFade(1)">1 min</button>
        <button @click="onFade(10)">10 min</button>
        <button @click="onFade(30)">30 min</button>
      </div>

      <button @click="onScheduleBlips">Schedule blips (every 10s for 45 min)</button>

      <p>
        ctx.state: {{ snapshot.ctxState }} · ctx.currentTime:
        {{ snapshot.ctxCurrentTime.toFixed(1) }} · strategy:
        {{ snapshot.strategy }}
      </p>
      <p>
        element paused: {{ snapshot.elementPaused }} · element currentTime:
        {{ snapshot.elementCurrentTime?.toFixed(1) }}
      </p>
      <p v-if="snapshot.elementVolumeReadsBack !== null">
        element.volume settable?: {{ snapshot.elementVolumeReadsBack }}
      </p>
    </section>

    <section class="panel">
      <h2>Continuity monitor</h2>
      <p>{{ continuityReport }}</p>
    </section>

    <section class="panel">
      <h2>JS heartbeat</h2>
      <p>max gap in the last 60s: {{ (heartbeatGap / 1000).toFixed(1) }}s</p>
    </section>

    <section class="panel">
      <h2>Brightness</h2>
      <p>
        {{ brightnessSupported ? 'supported' : 'unsupported (web)' }} · current:
        {{ brightnessValue }}
      </p>
      <button @click="onReadBrightness">Read brightness</button>
      <label
        >level <input v-model.number="brightnessSlider" type="range" min="0" max="1" step="0.01"
      /></label>
      <button @click="onSetBrightness(brightnessSlider)">Apply</button>
      <button @click="onSetBrightness(CONFIG.pacing.BRIGHTNESS_MIN)">
        Set min ({{ CONFIG.pacing.BRIGHTNESS_MIN }})
      </button>
      <button @click="onSetBrightness(0.5)">Set 0.5</button>
      <button @click="onRestoreBrightness">Restore</button>
    </section>

    <section class="panel">
      <h2>Wake lock</h2>
      <p>supported: {{ wakeLockSupported }} · held: {{ wakeLockHeld }}</p>
      <p class="dim">Set the OS auto-lock to 30s before testing.</p>
      <button @click="onAcquireWakeLock">Acquire</button>
      <button @click="onReleaseWakeLock">Release</button>
    </section>

    <section class="panel">
      <h2>Start preset</h2>
      <button @click="onStartPreset">Apply A1 preset &amp; play</button>
    </section>

    <section class="panel">
      <h2>Log</h2>
      <div class="log">
        <div v-for="(entry, i) in logEntries.slice(-100)" :key="i">
          [{{ entry.source }}] {{ entry.message }}
        </div>
      </div>
      <button @click="onCopyLog">Copy log</button>
      <button @click="onExportLog">Export log</button>
      <button @click="onClearLog">Clear log</button>
    </section>
  </main>
</template>

<style scoped>
.spike {
  padding: 16px;
  max-width: 720px;
  margin: 0 auto;
}

h1 {
  font-size: 22px;
}

.panel {
  border: 1px solid var(--color-text-dim);
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 16px;
}

button {
  min-height: 48px;
  min-width: 48px;
  font-size: 18px;
  margin: 4px;
  background: var(--color-water);
  color: var(--color-amber);
  border: 1px solid var(--color-text-dim);
  border-radius: 6px;
}

fieldset {
  border: 1px solid var(--color-text-dim);
  border-radius: 6px;
  margin: 8px 0;
}

label {
  display: block;
  margin: 4px 0;
  font-size: 18px;
}

.log {
  max-height: 240px;
  overflow-y: auto;
  font-family: monospace;
  font-size: 14px;
  background: var(--color-water);
  padding: 8px;
  border-radius: 6px;
}

.dim {
  color: var(--color-text-dim);
}
</style>
