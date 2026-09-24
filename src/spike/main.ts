import { createApp } from 'vue';

import '../ui/theme.css';
import SpikeApp from './SpikeApp.vue';

// eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- plain eslint (unlike vue-tsc) resolves a .vue import without the Vue TS plugin.
createApp(SpikeApp).mount('#spike');
