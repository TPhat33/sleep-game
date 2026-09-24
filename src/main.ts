import { createApp } from 'vue';

import { bootstrap } from './app/bootstrap';
import { ServicesKey } from './app/services';
import './ui/theme.css';
import App from './ui/App.vue';

async function main(): Promise<void> {
  const services = await bootstrap();
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- plain eslint (unlike vue-tsc) resolves a .vue import without the Vue TS plugin.
  const app = createApp(App);
  app.provide(ServicesKey, services);
  app.mount('#app');
}

void main();
