<script setup lang="ts">
import { onMounted, ref } from 'vue';

import type { LastSessionInfo } from '../../core/types';
import { useServices } from '../composables/useServices';

const emit = defineEmits<{ navigate: [tab: 'sky' | 'journal' | 'settings' | 'stats'] }>();

const services = useServices();
const lastSession = ref<LastSessionInfo | null>(null);
const listenDurationMs = ref(60 * 60_000);
const starting = ref(false);

const MS_PER_MINUTE = 60_000;

onMounted(async () => {
  const [settings, last] = await Promise.all([
    services.repositories.settings.get(),
    services.repositories.sessions.getLastSession(),
  ]);
  listenDurationMs.value = settings.listenDefaultMinutes * MS_PER_MINUTE;
  lastSession.value = last;
});

async function start(): Promise<void> {
  if (starting.value) return;
  starting.value = true;
  await services.audioEngine.unlock();
  services.director.start({
    lastSession: lastSession.value,
    listenDurationMs: listenDurationMs.value,
  });
}

async function listenOnly(): Promise<void> {
  if (starting.value) return;
  starting.value = true;
  await services.audioEngine.unlock();
  services.director.startListenOnly(listenDurationMs.value);
}
</script>

<template>
  <main class="home">
    <h1>บึงหิ่งห้อย</h1>
    <div class="actions">
      <button type="button" class="primary" :disabled="starting" @click="start">เริ่ม</button>
      <button type="button" class="secondary" :disabled="starting" @click="listenOnly">
        ฟังอย่างเดียว
      </button>
    </div>
    <nav class="tabs">
      <button type="button" @click="emit('navigate', 'sky')">ท้องฟ้า</button>
      <button type="button" @click="emit('navigate', 'journal')">สมุดความฝัน</button>
      <button type="button" @click="emit('navigate', 'stats')">สถิติของฉัน</button>
      <button type="button" @click="emit('navigate', 'settings')">ตั้งค่า</button>
    </nav>
  </main>
</template>

<style scoped>
.home {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 40px;
  background: var(--color-bg-night);
}

h1 {
  color: var(--color-amber);
  font-size: 32px;
  font-weight: 300;
  margin: 0;
}

.actions {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 100%;
  max-width: 280px;
  padding: 0 24px;
}

button {
  font-family: var(--font-thai);
  font-size: 18px;
  font-weight: 300;
  border-radius: 12px;
  padding: 14px 20px;
}

.primary {
  background: var(--color-amber);
  color: var(--color-bg-night);
  border: none;
}

.secondary {
  background: transparent;
  color: var(--color-amber);
  border: 1px solid var(--color-amber);
}

.primary:disabled,
.secondary:disabled {
  opacity: 0.5;
}

.tabs {
  display: flex;
  gap: 24px;
}

.tabs button {
  background: none;
  border: none;
  color: var(--color-text-dim);
  font-size: 14px;
  padding: 4px;
}
</style>
