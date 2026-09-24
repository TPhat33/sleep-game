import { describe, expect, it, vi } from 'vitest';

import { EventBus } from '@/core/events';

interface TestEvents {
  ping: { at: number; value: string };
  pong: { at: number };
}

describe('EventBus', () => {
  it('dispatches typed events to subscribers in subscription order', () => {
    const bus = new EventBus<TestEvents>();
    const order: string[] = [];
    bus.on('ping', (p) => order.push(`a:${p.value}`));
    bus.on('ping', (p) => order.push(`b:${p.value}`));
    bus.emit('ping', { at: 1, value: 'x' });
    expect(order).toEqual(['a:x', 'b:x']);
  });

  it('does not call listeners of a different event type', () => {
    const bus = new EventBus<TestEvents>();
    const pongFn = vi.fn();
    bus.on('pong', pongFn);
    bus.emit('ping', { at: 1, value: 'x' });
    expect(pongFn).not.toHaveBeenCalled();
  });

  it('unsubscribe() stops future dispatches', () => {
    const bus = new EventBus<TestEvents>();
    const fn = vi.fn();
    const off = bus.on('ping', fn);
    bus.emit('ping', { at: 1, value: 'x' });
    off();
    bus.emit('ping', { at: 2, value: 'y' });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('a listener unsubscribing itself does not skip other listeners', () => {
    const bus = new EventBus<TestEvents>();
    const order: string[] = [];
    let offA: () => void = () => undefined;
    offA = bus.on('ping', () => {
      order.push('a');
      offA();
    });
    bus.on('ping', () => order.push('b'));
    bus.on('ping', () => order.push('c'));
    bus.emit('ping', { at: 1, value: 'x' });
    expect(order).toEqual(['a', 'b', 'c']);

    order.length = 0;
    bus.emit('ping', { at: 2, value: 'y' });
    expect(order).toEqual(['b', 'c']);
  });

  it('a listener unsubscribing a later listener prevents that later listener from firing in the same dispatch', () => {
    const bus = new EventBus<TestEvents>();
    const order: string[] = [];
    let offB: () => void = () => undefined;
    bus.on('ping', () => {
      order.push('a');
      offB();
    });
    offB = bus.on('ping', () => order.push('b'));
    bus.on('ping', () => order.push('c'));
    bus.emit('ping', { at: 1, value: 'x' });
    expect(order).toEqual(['a', 'c']);
  });

  it('once() fires exactly one time', () => {
    const bus = new EventBus<TestEvents>();
    const fn = vi.fn();
    bus.once('ping', fn);
    bus.emit('ping', { at: 1, value: 'x' });
    bus.emit('ping', { at: 2, value: 'y' });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith({ at: 1, value: 'x' });
  });

  it('isolates a throwing listener: reports via onError and still runs the rest', () => {
    const errors: unknown[] = [];
    const bus = new EventBus<TestEvents>({ onError: (err) => errors.push(err) });
    const order: string[] = [];
    bus.on('ping', () => {
      order.push('a');
      throw new Error('boom');
    });
    bus.on('ping', () => order.push('b'));
    bus.emit('ping', { at: 1, value: 'x' });
    expect(order).toEqual(['a', 'b']);
    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe('boom');
  });

  it('propagates a listener error when onError rethrows', () => {
    const bus = new EventBus<TestEvents>({
      onError: (err) => {
        throw err;
      },
    });
    bus.on('ping', () => {
      throw new Error('boom');
    });
    expect(() => {
      bus.emit('ping', { at: 1, value: 'x' });
    }).toThrow('boom');
  });

  it('listenerCount() reports per-type and total counts', () => {
    const bus = new EventBus<TestEvents>();
    expect(bus.listenerCount()).toBe(0);
    bus.on('ping', () => undefined);
    bus.on('ping', () => undefined);
    bus.on('pong', () => undefined);
    expect(bus.listenerCount('ping')).toBe(2);
    expect(bus.listenerCount('pong')).toBe(1);
    expect(bus.listenerCount()).toBe(3);
  });

  it('clear() removes all listeners', () => {
    const bus = new EventBus<TestEvents>();
    const fn = vi.fn();
    bus.on('ping', fn);
    bus.clear();
    bus.emit('ping', { at: 1, value: 'x' });
    expect(fn).not.toHaveBeenCalled();
    expect(bus.listenerCount()).toBe(0);
  });

  it('emitting with no subscribers does not throw', () => {
    const bus = new EventBus<TestEvents>();
    expect(() => {
      bus.emit('ping', { at: 1, value: 'x' });
    }).not.toThrow();
  });
});
