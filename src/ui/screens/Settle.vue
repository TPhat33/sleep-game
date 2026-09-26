<script setup lang="ts">
// spec §5.1/M4: settle -> play via "closing the jar lid" or "skip". The
// jar lets the player type up to JAR_MAX_ITEMS worries/thoughts (each
// clamped to JAR_MAX_CHARS) before starting play — its contents never
// leave the device (spec §11) and are never read back by this screen.
import { computed, ref } from 'vue';

import { CONFIG } from '../../core/config';
import { useServices } from '../composables/useServices';

const services = useServices();
const items = ref<string[]>([]);
const draft = ref('');
const closing = ref(false);

const maxItems = CONFIG.meta.JAR_MAX_ITEMS;
const maxChars = CONFIG.meta.JAR_MAX_CHARS;

const canAdd = computed(() => items.value.length < maxItems && draft.value.trim().length > 0);
const atCapacity = computed(() => items.value.length >= maxItems);

function addItem(): void {
  if (!canAdd.value) return;
  items.value.push(draft.value.trim().slice(0, maxChars));
  draft.value = '';
}

function removeItem(index: number): void {
  items.value.splice(index, 1);
}

async function closeLid(): Promise<void> {
  if (closing.value) return;
  closing.value = true;
  if (items.value.length > 0) {
    await services.repositories.jar.addEntry(items.value);
  }
  services.director.completeSettle('jar_closed');
}

function skip(): void {
  if (closing.value) return;
  closing.value = true;
  services.director.completeSettle('settle_skipped');
}
</script>

<template>
  <main class="settle">
    <p class="prompt">Anything you'd like to put in the jar before sleep?</p>

    <ul class="jar-items">
      <li v-for="(item, index) in items" :key="index">
        <span>{{ item }}</span>
        <button type="button" class="remove" @click="removeItem(index)">×</button>
      </li>
    </ul>

    <div v-if="!atCapacity" class="input-row">
      <input
        v-model="draft"
        :maxlength="maxChars"
        type="text"
        placeholder="Type here..."
        @keyup.enter="addItem"
      />
      <button type="button" class="add" :disabled="!canAdd" @click="addItem">Add</button>
    </div>

    <div class="actions">
      <button type="button" class="primary" :disabled="closing" @click="closeLid">
        Close the jar
      </button>
      <button type="button" class="secondary" :disabled="closing" @click="skip">Skip</button>
    </div>
  </main>
</template>

<style scoped>
.settle {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 20px;
  padding: 24px;
  background: var(--color-bg-night);
}

.prompt {
  color: var(--color-amber);
  font-size: 18px;
  font-weight: 300;
  text-align: center;
  margin: 0;
}

.jar-items {
  list-style: none;
  margin: 0;
  padding: 0;
  width: 100%;
  max-width: 320px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 240px;
  overflow-y: auto;
}

.jar-items li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 10px;
  background: rgba(201, 138, 62, 0.12);
  color: var(--color-amber);
  font-size: 16px;
}

.remove {
  background: none;
  border: none;
  color: var(--color-text-dim);
  font-size: 16px;
  padding: 0 4px;
}

.input-row {
  display: flex;
  gap: 8px;
  width: 100%;
  max-width: 320px;
}

.input-row input {
  flex: 1;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--color-text-dim);
  background: transparent;
  color: var(--color-amber);
  font-family: var(--font-primary);
  font-size: 16px;
}

.add {
  padding: 10px 16px;
  border-radius: 10px;
  border: 1px solid var(--color-amber);
  background: transparent;
  color: var(--color-amber);
  font-family: var(--font-primary);
}

.add:disabled {
  opacity: 0.4;
}

.actions {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  max-width: 320px;
  margin-top: 12px;
}

.actions button {
  font-family: var(--font-primary);
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
  color: var(--color-text-dim);
  border: 1px solid var(--color-text-dim);
}

.actions button:disabled {
  opacity: 0.5;
}
</style>
