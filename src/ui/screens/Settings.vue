<script setup lang="ts">
import { onMounted, ref } from 'vue';

import { CONFIG } from '../../core/config';
import type { BedLayerId } from '../../core/types';
import type { SettingsRecord } from '../../store/db';
import { useServices } from '../composables/useServices';

defineEmits<{ back: [] }>();

const services = useServices();
const settings = ref<SettingsRecord | null>(null);

const LAYER_LABELS: Record<BedLayerId, string> = {
  rain: 'เสียงฝน',
  crickets: 'เสียงจิ้งหรีด',
  brownNoise: 'บราวน์นอยส์',
  asmrTaps: 'เสียงแตะเบาๆ',
};
const ALL_LAYERS: readonly BedLayerId[] = ['rain', 'crickets', 'brownNoise', 'asmrTaps'];

onMounted(async () => {
  settings.value = await services.repositories.settings.get();
});

async function toggleLayer(layer: BedLayerId): Promise<void> {
  if (!settings.value) return;
  const enabled = settings.value.enabledLayers.includes(layer);
  const enabledLayers = enabled
    ? settings.value.enabledLayers.filter((l) => l !== layer)
    : [...settings.value.enabledLayers, layer];
  settings.value = await services.repositories.settings.update({ enabledLayers });
}

async function toggleVoice(): Promise<void> {
  if (!settings.value) return;
  settings.value = await services.repositories.settings.update({
    voiceEnabled: !settings.value.voiceEnabled,
  });
}

async function toggleBreathCue(): Promise<void> {
  if (!settings.value) return;
  settings.value = await services.repositories.settings.update({
    breathCueEnabled: !settings.value.breathCueEnabled,
  });
}

async function setListenMinutes(minutes: number): Promise<void> {
  settings.value = await services.repositories.settings.update({ listenDefaultMinutes: minutes });
}
</script>

<template>
  <main v-if="settings" class="settings">
    <header>
      <button type="button" class="back" @click="$emit('back')">‹ กลับ</button>
      <h1>ตั้งค่า</h1>
    </header>

    <section>
      <p class="section-title">เสียงพื้นหลัง</p>
      <label v-for="layer in ALL_LAYERS" :key="layer" class="row">
        <input
          type="checkbox"
          :checked="settings.enabledLayers.includes(layer)"
          @change="toggleLayer(layer)"
        />
        <span>{{ LAYER_LABELS[layer] }}</span>
      </label>
    </section>

    <section>
      <label class="row">
        <input type="checkbox" :checked="settings.voiceEnabled" @change="toggleVoice" />
        <span>เสียงกระซิบคำ</span>
      </label>
      <label class="row">
        <input type="checkbox" :checked="settings.breathCueEnabled" @change="toggleBreathCue" />
        <span>เสียงหายใจนำ</span>
      </label>
    </section>

    <section>
      <p class="section-title">เวลาโหมดฟัง (นาที)</p>
      <div class="options">
        <button
          v-for="minutes in CONFIG.audio.LISTEN_OPTIONS_MIN"
          :key="minutes"
          type="button"
          class="option"
          :class="{ active: settings.listenDefaultMinutes === minutes }"
          @click="setListenMinutes(minutes)"
        >
          {{ minutes }}
        </button>
      </div>
    </section>
  </main>
</template>

<style scoped>
.settings {
  min-height: 100vh;
  background: var(--color-bg-night);
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 28px;
}

header {
  display: flex;
  align-items: center;
  gap: 16px;
}

.back {
  background: none;
  border: none;
  color: var(--color-text-dim);
  font-size: 16px;
}

h1 {
  color: var(--color-amber);
  font-size: 22px;
  font-weight: 300;
  margin: 0;
}

.section-title {
  color: var(--color-text-dim);
  font-size: 13px;
  margin: 0 0 10px;
}

.row {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--color-amber);
  font-size: 16px;
  padding: 8px 0;
}

.options {
  display: flex;
  gap: 12px;
}

.option {
  flex: 1;
  padding: 10px;
  border-radius: 10px;
  border: 1px solid var(--color-text-dim);
  background: transparent;
  color: var(--color-text-dim);
  font-family: var(--font-thai);
  font-size: 16px;
}

.option.active {
  border-color: var(--color-amber);
  color: var(--color-amber);
}
</style>
