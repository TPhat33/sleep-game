<script setup lang="ts">
// spec §5.2: shown once per session when play+drift has run long and the
// player looks alert again — offers listen mode, continuing, or stopping.
// Self-contained: subscribes to 'ui:gentleExit' itself, so any screen can
// just drop this component in.
import { onUnmounted, ref } from 'vue';

import { useServices } from '../composables/useServices';

const services = useServices();
const visible = ref(false);
const listenDurationMs = ref(60 * 60_000);

const MS_PER_MINUTE = 60_000;

async function loadListenDuration(): Promise<void> {
  const settings = await services.repositories.settings.get();
  listenDurationMs.value = settings.listenDefaultMinutes * MS_PER_MINUTE;
}

const off = services.bus.on('ui:gentleExit', () => {
  visible.value = true;
  void loadListenDuration();
});
onUnmounted(off);

function choose(choice: 'listen' | 'continue' | 'rest'): void {
  visible.value = false;
  services.director.gentleExitChoice(choice, listenDurationMs.value);
}
</script>

<template>
  <div v-if="visible" class="overlay">
    <div class="prompt">
      <p>คืนนี้หลับยากหน่อยนะ จะลองโหมดฟังแบบปิดจอ หรือลุกไปนั่งพักที่อื่นสักครู่ก่อนก็ได้</p>
      <div class="choices">
        <button type="button" class="choice" @click="choose('listen')">ลองโหมดฟัง (ปิดจอ)</button>
        <button type="button" class="choice" @click="choose('continue')">เล่นต่อ</button>
        <button type="button" class="choice secondary" @click="choose('rest')">พักก่อน</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(11, 8, 6, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1500;
  padding: 24px;
}

.prompt {
  max-width: 340px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  text-align: center;
}

.prompt p {
  color: var(--color-amber);
  font-size: 17px;
  font-weight: 300;
  line-height: 1.6;
  margin: 0;
}

.choices {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.choice {
  padding: 12px 18px;
  border-radius: 12px;
  border: 1px solid var(--color-amber);
  background: transparent;
  color: var(--color-amber);
  font-family: var(--font-thai);
  font-size: 16px;
  font-weight: 300;
}

.choice.secondary {
  border-color: var(--color-text-dim);
  color: var(--color-text-dim);
}
</style>
