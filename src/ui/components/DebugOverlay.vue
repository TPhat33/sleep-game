<script setup lang="ts">
// M3 acceptance criterion: `?debug=1` shows score/features/phase realtime.
import { onUnmounted, ref } from 'vue';

import type { DrowsinessSample } from '../../core/types';
import { useDirectorState } from '../composables/useDirectorState';
import { useServices } from '../composables/useServices';

const services = useServices();
const director = useDirectorState(services);
const lastSample = ref<DrowsinessSample | null>(null);

const off = services.bus.on('drowsiness:sample', (e) => {
  lastSample.value = e.sample;
});
onUnmounted(off);
</script>

<template>
  <div class="debug-overlay">
    <div>phase: {{ director.phase }}</div>
    <div>score: {{ lastSample ? lastSample.score.toFixed(3) : '-' }}</div>
    <template v-if="lastSample">
      <div>rtMedian: {{ lastSample.features.rtMedian ?? '-' }}</div>
      <div>itiMedian: {{ lastSample.features.itiMedian ?? '-' }}</div>
      <div>itiCv: {{ lastSample.features.itiCv?.toFixed(3) ?? '-' }}</div>
      <div>missRate: {{ lastSample.features.missRate.toFixed(3) }}</div>
      <div>tapCount: {{ lastSample.features.tapCount }}</div>
    </template>
  </div>
</template>

<style scoped>
.debug-overlay {
  position: fixed;
  top: 4px;
  left: 4px;
  z-index: 2000;
  background: rgba(11, 8, 6, 0.85);
  color: var(--color-firefly);
  font-family: monospace;
  font-size: 11px;
  line-height: 1.4;
  padding: 6px 8px;
  pointer-events: none;
  border-radius: 4px;
}
</style>
