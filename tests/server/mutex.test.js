import { describe, it, expect } from 'vitest';
import { createMutex } from '../../server/mutex.js';

describe('Mutex', () => {
  it('executes function and returns result', async () => {
    const mutex = createMutex();
    const result = await mutex.withLock(() => 42);
    expect(result).toBe(42);
  });

  it('serializes concurrent access', async () => {
    const mutex = createMutex();
    const order = [];

    const task = (id, delay) => mutex.withLock(async () => {
      order.push(`start-${id}`);
      await new Promise((r) => setTimeout(r, delay));
      order.push(`end-${id}`);
    });

    await Promise.all([task('a', 50), task('b', 10), task('c', 10)]);
    expect(order).toEqual(['start-a', 'end-a', 'start-b', 'end-b', 'start-c', 'end-c']);
  });

  it('releases lock on error', async () => {
    const mutex = createMutex();
    try {
      await mutex.withLock(() => { throw new Error('fail'); });
    } catch {}
    const result = await mutex.withLock(() => 'ok');
    expect(result).toBe('ok');
  });
});
