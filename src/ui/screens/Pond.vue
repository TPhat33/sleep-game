<script setup lang="ts">
// Host for the PixiJS canvas — spec §8. All gameplay logic lives in
// scene/PondScene.ts + scene/model/PondModel.ts; this screen just mounts
// it, forwards taps, and persists the meta side effects (journal, stars,
// constellation completion) PondScene reports back via callbacks.
import { onBeforeUnmount, onMounted, ref } from 'vue';

import constellationsContent from '../../content/constellations.json';
import dreamsContent from '../../content/dreams.json';
import { CONFIG } from '../../core/config';
import { nextStarSlot } from '../../core/constellationProgress';
import type { Unsubscribe } from '../../core/events';
import type { ConstellationDef, DreamColor, DreamDef } from '../../core/types';
import { PondScene } from '../../scene/PondScene';
import GentleExitPrompt from '../components/GentleExitPrompt.vue';
import { useServices } from '../composables/useServices';

const services = useServices();
const containerRef = ref<HTMLDivElement | null>(null);
const listenOfferShown = ref(false);
const listenDurationMs = ref(60 * 60_000);

const MS_PER_MINUTE = 60_000;
const typedDreams = dreamsContent as DreamDef[];
const typedConstellations = constellationsContent as ConstellationDef[];

let scene: PondScene | null = null;
let resizeObserver: ResizeObserver | null = null;
const offs: Unsubscribe[] = [];

async function handleStarEarned(_color: DreamColor, golden: boolean): Promise<void> {
  const progress = await services.repositories.progress.get();
  const counts = new Map<string, number>();
  for (const star of progress.stars) {
    counts.set(star.constellationId, (counts.get(star.constellationId) ?? 0) + 1);
  }
  const slot = nextStarSlot(typedConstellations, new Set(progress.completedConstellations), counts);
  if (!slot) return;
  await services.repositories.progress.addStar({
    constellationId: slot.constellationId,
    index: slot.index,
    golden,
  });
  if (slot.completesConstellation) {
    await services.repositories.progress.completeConstellation(slot.constellationId);
  }
}

onMounted(async () => {
  const container = containerRef.value;
  if (!container) return;

  const settings = await services.repositories.settings.get();
  listenDurationMs.value = settings.listenDefaultMinutes * MS_PER_MINUTE;
  services.audioEngine.setBed(settings.enabledLayers);

  scene = new PondScene({
    clock: services.clock,
    rng: services.rng,
    bus: services.bus,
    director: services.director,
    pacing: services.pacing,
    audioEngine: services.audioEngine,
    dreams: typedDreams,
    cfg: { scene: CONFIG.scene, session: CONFIG.session, pacing: CONFIG.pacing },
    onDreamSeen: (defId) => {
      void services.repositories.progress.addJournalEntry(defId);
    },
    onStarEarned: (color, golden) => {
      void handleStarEarned(color, golden);
    },
  });
  scene.setVoicePreference(settings.voiceEnabled);
  await scene.mount(container);

  resizeObserver = new ResizeObserver(() => {
    scene?.handleResize();
  });
  resizeObserver.observe(container);

  offs.push(
    services.bus.on('ui:listenOffer', () => {
      listenOfferShown.value = true;
    }),
  );
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
  for (const off of offs) off();
  offs.length = 0;
  scene?.dispose();
  scene = null;
});

function handlePointerDown(event: PointerEvent): void {
  const container = containerRef.value;
  if (!container || !scene) return;
  const rect = container.getBoundingClientRect();
  scene.handleTap(event.clientX - rect.left, event.clientY - rect.top);
}

function requestListen(): void {
  const reason = listenOfferShown.value ? 'listen_offer' : 'listen_button';
  services.director.requestListen(reason, listenDurationMs.value);
}
</script>

<template>
  <main class="pond">
    <div ref="containerRef" class="canvas-host" @pointerdown="handlePointerDown" />
    <button type="button" class="listen-button" @click="requestListen">
      {{ listenOfferShown ? 'ฟังต่อแบบปิดจอ' : 'ฟังแบบปิดจอ' }}
    </button>
    <GentleExitPrompt />
  </main>
</template>

<style scoped>
.pond {
  position: relative;
  width: 100vw;
  height: 100vh;
  background: var(--color-bg-night);
  overflow: hidden;
}

.canvas-host {
  position: absolute;
  inset: 0;
}

.listen-button {
  position: absolute;
  top: 16px;
  right: 16px;
  background: rgba(11, 8, 6, 0.5);
  border: 1px solid var(--color-text-dim);
  color: var(--color-text-dim);
  border-radius: 16px;
  padding: 8px 14px;
  font-family: var(--font-thai);
  font-size: 13px;
  opacity: 0.7;
}
</style>
