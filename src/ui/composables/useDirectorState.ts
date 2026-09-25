// Bridges SessionDirector's "events out" bus into Vue reactivity, so
// screens can just read `director.phase` etc. rather than each wiring its
// own bus.on() listeners. SessionDirector itself stays framework-free.
import { onUnmounted, reactive, readonly } from 'vue';
import type { DeepReadonly } from 'vue';

import type { AppEvents } from '../../core/events';
import type { DirectorSnapshot } from '../../core/session/SessionDirector';
import type { Services } from '../../app/services';

const WATCHED_EVENTS: readonly (keyof AppEvents)[] = [
  'session:started',
  'phase:changed',
  'tap:recorded',
  'drowsiness:sample',
  'listen:extended',
  'app:lifecycle',
  'session:ended',
];

export function useDirectorState(services: Services): DeepReadonly<DirectorSnapshot> {
  const state = reactive(services.director.snapshot());

  function refresh(): void {
    Object.assign(state, services.director.snapshot());
  }

  const unsubs = WATCHED_EVENTS.map((type) => services.bus.on(type, refresh));
  onUnmounted(() => {
    for (const off of unsubs) off();
  });

  return readonly(state);
}
