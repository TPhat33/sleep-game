<script setup lang="ts">
// The dream journal — spec §11: dreams the player has seen (tapped into a
// boat at least once), matched against content/dreams.json for display.
import { computed, onMounted, ref } from 'vue';

import dreamsContent from '../../content/dreams.json';
import type { DreamDef } from '../../core/types';
import { useServices } from '../composables/useServices';

defineEmits<{ back: [] }>();

const services = useServices();
const typedDreams = dreamsContent as DreamDef[];
const seenIds = ref<string[]>([]);

onMounted(async () => {
  const progress = await services.repositories.progress.get();
  seenIds.value = progress.journal;
});

const seenDreams = computed(() => typedDreams.filter((d) => seenIds.value.includes(d.id)));
const seenSet = computed(() => new Set(seenIds.value));
</script>

<template>
  <main class="journal">
    <header>
      <button type="button" class="back" @click="$emit('back')">‹ กลับ</button>
      <h1>สมุดความฝัน</h1>
    </header>

    <p class="count">{{ seenDreams.length }} / {{ typedDreams.length }}</p>

    <div class="grid">
      <div
        v-for="dream in typedDreams"
        :key="dream.id"
        class="entry"
        :class="{ seen: seenSet.has(dream.id) }"
      >
        <img v-if="seenSet.has(dream.id)" :src="dream.sprite" :alt="dream.nameTh" class="sprite" />
        <div v-else class="sprite placeholder" />
        <p class="label">{{ seenSet.has(dream.id) ? dream.nameTh : '?' }}</p>
      </div>
    </div>
  </main>
</template>

<style scoped>
.journal {
  min-height: 100vh;
  background: var(--color-bg-night);
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
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

.count {
  color: var(--color-text-dim);
  font-size: 14px;
  margin: 0;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
  gap: 16px;
}

.entry {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  opacity: 0.4;
}

.entry.seen {
  opacity: 1;
}

.sprite {
  width: 48px;
  height: 48px;
}

.sprite.placeholder {
  border-radius: 50%;
  background: var(--color-water);
}

.label {
  color: var(--color-text-dim);
  font-size: 12px;
  margin: 0;
  text-align: center;
}
</style>
