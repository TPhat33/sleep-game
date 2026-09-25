import { inject } from 'vue';

import { ServicesKey } from '../../app/services';
import type { Services } from '../../app/services';

export function useServices(): Services {
  const services = inject(ServicesKey);
  if (!services) {
    throw new Error('useServices() called outside a component tree that provides Services');
  }
  return services;
}
