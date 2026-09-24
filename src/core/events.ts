// Typed, synchronous event bus. SessionDirector and friends are "commands
// in, events out" (plan §1.2): every state change is published here, and UI
// / audio / platform code reacts to events rather than being called directly.

import type { DrowsinessSample, LifecycleState, Phase, SessionSummary, TapEvent } from './types';

export type Unsubscribe = () => void;

export interface EventBusOptions<M extends object> {
  /** Called when a listener throws. Default: logs to console.error and keeps going. */
  onError?: (err: unknown, type: keyof M) => void;
}

/**
 * Dispatch is synchronous, in subscription order. A throwing listener is
 * isolated (reported via `onError`); the remaining listeners still run. No
 * wildcards, no string-typed events — adding an event means adding a key to
 * the event map.
 */
export class EventBus<M extends object> {
  private readonly listeners = new Map<keyof M, Set<(payload: M[keyof M]) => void>>();
  private readonly onError: (err: unknown, type: keyof M) => void;

  constructor(opts?: EventBusOptions<M>) {
    this.onError =
      opts?.onError ??
      ((err) => {
        console.error(err);
      });
  }

  on<K extends keyof M>(type: K, fn: (payload: M[K]) => void): Unsubscribe {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    const handler = fn as (payload: M[keyof M]) => void;
    set.add(handler);
    return () => {
      set.delete(handler);
    };
  }

  once<K extends keyof M>(type: K, fn: (payload: M[K]) => void): Unsubscribe {
    const off = this.on(type, (payload) => {
      off();
      fn(payload);
    });
    return off;
  }

  emit<K extends keyof M>(type: K, payload: M[K]): void {
    const set = this.listeners.get(type);
    if (!set || set.size === 0) return;
    // Snapshot so a listener that unsubscribes another doesn't corrupt this
    // dispatch's iteration; the has() check still honors a mid-dispatch
    // unsubscribe of a listener whose turn hasn't come yet.
    for (const fn of Array.from(set)) {
      if (!set.has(fn)) continue;
      try {
        fn(payload);
      } catch (err) {
        this.onError(err, type);
      }
    }
  }

  listenerCount(type?: keyof M): number {
    if (type === undefined) {
      let total = 0;
      for (const set of this.listeners.values()) total += set.size;
      return total;
    }
    return this.listeners.get(type)?.size ?? 0;
  }

  clear(): void {
    this.listeners.clear();
  }
}

export type TransitionReason =
  | 'start'
  | 'night_wake'
  | 'listen_only' // from home
  | 'jar_closed'
  | 'settle_skipped' // settle -> play
  | 'drowsy'
  | 'play_max' // play -> drift
  | 'listen_button'
  | 'listen_offer'
  | 'gentle_exit_listen' // -> listen
  | 'idle' // play/drift -> fade
  | 'fade_complete'
  | 'listen_timer' // -> ended
  | 'user_exit'
  | 'app_background'; // -> ended

export interface AppEvents {
  'session:started': { at: number; sessionId: string; nightWake: boolean };
  'phase:changed': {
    at: number;
    from: Phase;
    to: Phase;
    reason: TransitionReason;
    /** Present iff `to === 'listen'`. */
    listenDurationMs?: number;
  };
  'tap:recorded': { at: number; tap: TapEvent };
  'drowsiness:sample': { at: number; sample: DrowsinessSample };
  /** Once per session. */
  'ui:listenOffer': { at: number };
  /** Once per session. */
  'ui:gentleExit': { at: number };
  'listen:extended': { at: number; newEndsAt: number };
  'app:lifecycle': { at: number; state: LifecycleState };
  'scene:starEarned': { at: number; golden: boolean };
  'session:ended': { at: number; summary: SessionSummary };
}
