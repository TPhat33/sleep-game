<script setup lang="ts">
// spec §11/M4: constellations built from earned stars, plus the pending
// night visitor, revealed only during NightWakeDetector.isRevealWindow()
// (daytime) — never at night, so it doesn't turn into a bedtime reward hook.
import { computed, onMounted, ref } from 'vue';

import constellationsContent from '../../content/constellations.json';
import visitorsContent from '../../content/visitors.json';
import type { ConstellationDef, VisitorDef } from '../../core/types';
import type { ProgressRecord } from '../../store/db';
import { useServices } from '../composables/useServices';

defineEmits<{ back: [] }>();

const services = useServices();
const typedConstellations = constellationsContent as ConstellationDef[];
const typedVisitors = visitorsContent as VisitorDef[];

const progress = ref<ProgressRecord | null>(null);
const revealedVisitor = ref<VisitorDef | null>(null);

onMounted(async () => {
  const p = await services.repositories.progress.get();
  progress.value = p;
  if (p.pendingVisitor && services.nightWake.isRevealWindow()) {
    revealedVisitor.value = typedVisitors.find((v) => v.id === p.pendingVisitor) ?? null;
  }
});

function starAt(constellationId: string, index: number) {
  return (
    progress.value?.stars.find((s) => s.constellationId === constellationId && s.index === index) ??
    null
  );
}

const completed = computed(() => new Set(progress.value?.completedConstellations ?? []));

async function dismissVisitor(): Promise<void> {
  const visitor = revealedVisitor.value;
  if (!visitor) return;
  const p = await services.repositories.progress.addVisitor(visitor.id);
  await services.repositories.progress.setPendingVisitor(null);
  progress.value = { ...p, pendingVisitor: null };
  revealedVisitor.value = null;
}
</script>

<template>
  <main class="sky">
    <header>
      <button type="button" class="back" @click="$emit('back')">‹ กลับ</button>
      <h1>ท้องฟ้า</h1>
    </header>

    <div v-if="revealedVisitor" class="visitor-card" @click="dismissVisitor">
      <p class="visitor-label">แขกยามค่ำคืนนี้</p>
      <p class="visitor-name">{{ revealedVisitor.nameTh }}</p>
    </div>

    <div class="constellations">
      <div
        v-for="c in typedConstellations"
        :key="c.id"
        class="constellation"
        :class="{ complete: completed.has(c.id) }"
      >
        <p class="name">{{ c.nameTh }}</p>
        <div class="stars-box">
          <span
            v-for="(star, index) in c.stars"
            :key="index"
            class="star"
            :class="{ lit: starAt(c.id, index), golden: starAt(c.id, index)?.golden }"
            :style="{ left: `${star.x * 100}%`, top: `${star.y * 100}%` }"
          />
        </div>
      </div>
    </div>
  </main>
</template>

<style scoped>
.sky {
  min-height: 100vh;
  background: var(--color-bg-night);
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 20px;
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

.visitor-card {
  padding: 16px;
  border-radius: 12px;
  background: rgba(240, 196, 106, 0.12);
  text-align: center;
}

.visitor-label {
  color: var(--color-text-dim);
  font-size: 13px;
  margin: 0 0 6px;
}

.visitor-name {
  color: var(--color-gold);
  font-size: 20px;
  margin: 0;
}

.constellations {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.constellation .name {
  color: var(--color-text-dim);
  font-size: 14px;
  margin: 0 0 8px;
}

.constellation.complete .name {
  color: var(--color-gold);
}

.stars-box {
  position: relative;
  width: 100%;
  aspect-ratio: 1;
  max-width: 280px;
  border-radius: 12px;
  background: var(--color-water);
}

.star {
  position: absolute;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgba(227, 178, 90, 0.25);
  transform: translate(-50%, -50%);
}

.star.lit {
  background: var(--color-firefly);
  box-shadow: 0 0 6px var(--color-firefly);
}

.star.golden {
  background: var(--color-gold);
  box-shadow: 0 0 8px var(--color-gold);
}
</style>
