// Re-exports so callers can `import { Phase } from './session/phases'` if
// they prefer that path — the type itself is defined in core/types.ts since
// events.ts and other core modules need it too.
export type { Phase } from '../types';
