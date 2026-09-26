<script setup lang="ts">
// spec §11: shown the first time the app opens 05:00-12:00 after a night
// with a session (gating computed in App.vue via core/morningSurvey.ts).
// Skippable, one question.
import { localDateKey } from '../../core/time';
import type { EaseOfSleepRating } from '../../store/db';
import { useServices } from '../composables/useServices';

const emit = defineEmits<{ done: [] }>();

const services = useServices();
const RATINGS: readonly EaseOfSleepRating[] = [1, 2, 3, 4, 5];

async function answer(rating: EaseOfSleepRating): Promise<void> {
  const now = services.clock.now();
  await services.repositories.surveys.answer(localDateKey(now), rating, now);
  emit('done');
}
</script>

<template>
  <div class="overlay">
    <div class="survey">
      <p>How easily did you fall asleep last night?</p>
      <div class="ratings">
        <button
          v-for="rating in RATINGS"
          :key="rating"
          type="button"
          class="rating"
          @click="answer(rating)"
        >
          {{ rating }}
        </button>
      </div>
      <button type="button" class="skip" @click="emit('done')">Skip</button>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(11, 8, 6, 0.92);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1500;
  padding: 24px;
}

.survey {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
  text-align: center;
}

.survey p {
  color: var(--color-amber);
  font-size: 17px;
  font-weight: 300;
  margin: 0;
}

.ratings {
  display: flex;
  gap: 10px;
}

.rating {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 1px solid var(--color-amber);
  background: transparent;
  color: var(--color-amber);
  font-size: 16px;
}

.skip {
  background: none;
  border: none;
  color: var(--color-text-dim);
  font-size: 14px;
}
</style>
