<script setup lang="ts">
// spec M1: pure black screen, minimum brightness; a tap reveals dim
// stop/extend controls for LISTEN_CONTROLS_VISIBLE_MS, then they fade
// again. No countdown or remaining-time display — spec pillar 1 forbids
// any visible timer/score.
import { onUnmounted, ref } from 'vue';
import type { TimerId } from '../../core/clock';

import { CONFIG } from '../../core/config';
import { useServices } from '../composables/useServices';

const services = useServices();
const controlsVisible = ref(false);
let hideTimerId: TimerId | null = null;

function clearHideTimer(): void {
  if (hideTimerId !== null) {
    services.clock.clearTimeout(hideTimerId);
    hideTimerId = null;
  }
}

function reveal(): void {
  controlsVisible.value = true;
  clearHideTimer();
  hideTimerId = services.clock.setTimeout(() => {
    controlsVisible.value = false;
    hideTimerId = null;
  }, CONFIG.session.LISTEN_CONTROLS_VISIBLE_MS);
}

onUnmounted(clearHideTimer);

function stop(): void {
  services.director.exit();
}

function extend(): void {
  services.director.extendListen(CONFIG.session.LISTEN_EXTEND_MS);
  reveal();
}
</script>

<template>
  <main class="listen" @click="reveal">
    <div v-if="controlsVisible" class="controls">
      <button type="button" class="control" @click.stop="extend">Extend</button>
      <button type="button" class="control" @click.stop="stop">Stop</button>
    </div>
  </main>
</template>

<style scoped>
.listen {
  min-height: 100vh;
  width: 100%;
  background: #000000;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding-bottom: 48px;
}

.controls {
  display: flex;
  gap: 24px;
}

.control {
  background: none;
  border: 1px solid var(--color-text-dim);
  color: var(--color-text-dim);
  border-radius: 20px;
  padding: 10px 20px;
  font-family: var(--font-primary);
  font-size: 14px;
  opacity: 0.6;
}
</style>
