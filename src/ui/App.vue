<script setup lang="ts">
const showSpikeLink = import.meta.env.DEV || import.meta.env.VITE_INCLUDE_SPIKE === '1';
</script>

<template>
  <main class="home">
    <h1>บึงหิ่งห้อย</h1>
    <a v-if="showSpikeLink" class="spike-link" href="./spike.html">Platform spike →</a>
  </main>
</template>

<style scoped>
.home {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: var(--color-bg-night);
}

h1 {
  color: var(--color-amber);
  font-size: 32px;
  font-weight: 300;
}

.spike-link {
  margin-top: 24px;
  color: var(--color-text-dim);
  font-size: 18px;
}
</style>
