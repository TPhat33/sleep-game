<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

import { shouldShowMorningSurvey } from '../core/morningSurvey';
import { CONFIG } from '../core/config';
import { localDateKey } from '../core/time';
import DebugOverlay from './components/DebugOverlay.vue';
import { useDirectorState } from './composables/useDirectorState';
import { useServices } from './composables/useServices';
import Home from './screens/Home.vue';
import Journal from './screens/Journal.vue';
import Listen from './screens/Listen.vue';
import MorningSurvey from './screens/MorningSurvey.vue';
import Onboarding from './screens/Onboarding.vue';
import Pond from './screens/Pond.vue';
import Settings from './screens/Settings.vue';
import Settle from './screens/Settle.vue';
import Sky from './screens/Sky.vue';

type HomeTab = 'home' | 'sky' | 'journal' | 'settings';

const services = useServices();
const director = useDirectorState(services);

const showSpikeLink = import.meta.env.DEV || import.meta.env.VITE_INCLUDE_SPIKE === '1';
const debugEnabled = new URLSearchParams(location.search).get('debug') === '1';

const onboarded = ref(false);
const readyToRoute = ref(false);
const homeTab = ref<HomeTab>('home');
const showMorningSurvey = ref(false);

const scenePhase = computed(
  () => director.phase === 'play' || director.phase === 'drift' || director.phase === 'fade',
);

onMounted(async () => {
  const [settings, lastSession, survey] = await Promise.all([
    services.repositories.settings.get(),
    services.repositories.sessions.getLastSession(),
    services.repositories.surveys.get(localDateKey(services.clock.now())),
  ]);
  onboarded.value = settings.sleepLatencyBucket !== null;
  showMorningSurvey.value = shouldShowMorningSurvey(
    services.clock.now(),
    CONFIG.meta,
    lastSession,
    survey !== null,
  );
  readyToRoute.value = true;
});

function handleOnboarded(): void {
  onboarded.value = true;
}

function handleSurveyDone(): void {
  showMorningSurvey.value = false;
}
</script>

<template>
  <div class="app-root">
    <template v-if="!readyToRoute" />
    <Onboarding v-else-if="!onboarded" @done="handleOnboarded" />
    <Settle v-else-if="director.phase === 'settle'" />
    <Pond v-else-if="scenePhase" />
    <Listen v-else-if="director.phase === 'listen'" />
    <template v-else>
      <Home v-if="homeTab === 'home'" @navigate="homeTab = $event" />
      <Sky v-else-if="homeTab === 'sky'" @back="homeTab = 'home'" />
      <Journal v-else-if="homeTab === 'journal'" @back="homeTab = 'home'" />
      <Settings v-else-if="homeTab === 'settings'" @back="homeTab = 'home'" />
    </template>

    <MorningSurvey v-if="readyToRoute && showMorningSurvey" @done="handleSurveyDone" />
    <DebugOverlay v-if="debugEnabled" />

    <a v-if="showSpikeLink" class="spike-link" href="./spike.html">Platform spike →</a>
  </div>
</template>

<style scoped>
.app-root {
  min-height: 100vh;
  background: var(--color-bg-night);
}

.spike-link {
  position: fixed;
  right: 8px;
  bottom: 8px;
  color: var(--color-text-dim);
  font-size: 12px;
  opacity: 0.6;
  z-index: 1000;
}
</style>
