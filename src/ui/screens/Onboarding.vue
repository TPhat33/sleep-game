<script setup lang="ts">
// spec M4 acceptance: a single sleep-latency-bucket question, then
// straight into the app. No accounts, no tutorial carousel (design
// pillar: no streak/gamification pressure).
import { ref } from 'vue';

import type { SleepLatencyBucket } from '../../store/db';
import { useServices } from '../composables/useServices';

const emit = defineEmits<{ done: [] }>();

const services = useServices();
const saving = ref(false);

const OPTIONS: { value: SleepLatencyBucket; label: string }[] = [
  { value: '<15', label: 'Less than 15 minutes' },
  { value: '15-30', label: '15–30 minutes' },
  { value: '>30', label: 'More than 30 minutes' },
];

async function choose(bucket: SleepLatencyBucket): Promise<void> {
  if (saving.value) return;
  saving.value = true;
  await services.repositories.settings.update({ sleepLatencyBucket: bucket });
  emit('done');
}
</script>

<template>
  <main class="onboarding">
    <h1>Hushglow</h1>
    <p class="question">How long does it usually take you to fall asleep?</p>
    <div class="options">
      <button
        v-for="opt in OPTIONS"
        :key="opt.value"
        type="button"
        class="option"
        :disabled="saving"
        @click="choose(opt.value)"
      >
        {{ opt.label }}
      </button>
    </div>
  </main>
</template>

<style scoped>
.onboarding {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 32px;
  padding: 24px;
  background: var(--color-bg-night);
  text-align: center;
}

h1 {
  color: var(--color-amber);
  font-size: 28px;
  font-weight: 300;
  margin: 0;
}

.question {
  color: var(--color-text-dim);
  font-size: 18px;
  margin: 0;
  max-width: 320px;
}

.options {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  max-width: 320px;
}

.option {
  padding: 14px 20px;
  border-radius: 12px;
  border: 1px solid var(--color-amber);
  background: transparent;
  color: var(--color-amber);
  font-family: var(--font-primary);
  font-size: 18px;
  font-weight: 300;
}

.option:disabled {
  opacity: 0.5;
}
</style>
