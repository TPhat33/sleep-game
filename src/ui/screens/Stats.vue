<script setup lang="ts">
// "สถิติของฉัน" (my stats) — spec §12 M5, plan §6 M5: computed from the
// sessions store only. No session-by-session detail, no numbers that read
// as a score — just the two aggregate rates plus an average, matching
// design pillar 1 (no visible score/timer during play; this is a
// reflective summary screen, not part of the play loop).
import { onMounted, ref } from 'vue';

import { computeSessionStats } from '../../core/sessionStats';
import type { SessionStats } from '../../core/sessionStats';
import { useServices } from '../composables/useServices';

defineEmits<{ back: [] }>();

const services = useServices();
const stats = ref<SessionStats | null>(null);

const BUCKET_LABELS: Record<'normal' | 'night_wake', string> = {
  normal: 'เซสชันปกติ',
  night_wake: 'ตื่นกลางดึก',
};

function formatMinutes(value: number | null): string {
  if (value === null) return '—';
  return `${value.toFixed(0)} นาที`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

onMounted(async () => {
  const sessions = await services.repositories.sessions.list();
  stats.value = computeSessionStats(sessions);
});
</script>

<template>
  <main class="stats">
    <header>
      <button type="button" class="back" @click="$emit('back')">‹ กลับ</button>
      <h1>สถิติของฉัน</h1>
    </header>

    <template v-if="stats">
      <section v-if="stats.overall.sessionCount === 0" class="empty">
        <p>ยังไม่มีข้อมูลเซสชัน</p>
      </section>
      <template v-else>
        <section class="card">
          <p class="label">เวลาเฉลี่ยกว่าจะหลับ</p>
          <p class="value">{{ formatMinutes(stats.overall.averageMinutesToFade) }}</p>
        </section>
        <section class="card">
          <p class="label">จบเซสชันด้วยการหลับ</p>
          <p class="value">{{ formatPercent(stats.overall.fadeRate) }}</p>
        </section>
        <section class="card">
          <p class="label">จบเซสชันด้วยโหมดฟัง</p>
          <p class="value">{{ formatPercent(stats.overall.listenRate) }}</p>
        </section>

        <div class="buckets">
          <div v-for="bucket in stats.byBucket" :key="bucket.bucket" class="bucket">
            <p class="bucket-title">
              {{ BUCKET_LABELS[bucket.bucket] }} ({{ bucket.sessionCount }})
            </p>
            <p class="bucket-row">
              เฉลี่ยกว่าจะหลับ: {{ formatMinutes(bucket.averageMinutesToFade) }}
            </p>
            <p class="bucket-row">
              หลับ: {{ formatPercent(bucket.fadeRate) }} · ฟัง:
              {{ formatPercent(bucket.listenRate) }}
            </p>
          </div>
        </div>
      </template>
    </template>
  </main>
</template>

<style scoped>
.stats {
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

.empty p {
  color: var(--color-text-dim);
  font-size: 15px;
}

.card {
  padding: 16px;
  border-radius: 12px;
  background: rgba(201, 138, 62, 0.1);
}

.card .label {
  color: var(--color-text-dim);
  font-size: 13px;
  margin: 0 0 4px;
}

.card .value {
  color: var(--color-amber);
  font-size: 24px;
  margin: 0;
}

.buckets {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 8px;
}

.bucket {
  padding: 12px 16px;
  border-radius: 10px;
  border: 1px solid rgba(138, 106, 74, 0.3);
}

.bucket-title {
  color: var(--color-text-dim);
  font-size: 13px;
  margin: 0 0 6px;
}

.bucket-row {
  color: var(--color-amber);
  font-size: 14px;
  margin: 2px 0;
}
</style>
