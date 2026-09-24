import { beforeEach, describe, expect, it, vi } from 'vitest';

const isNativePlatform = vi.fn<() => boolean>();
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform, getPlatform: () => 'ios' },
}));

const createWebPlatform = vi.fn<() => { marker: string }>(() => ({ marker: 'web' }));
vi.mock('@/platform/web', () => ({ createWebPlatform }));

const createCapacitorPlatform = vi.fn<() => Promise<{ marker: string }>>(() =>
  Promise.resolve({ marker: 'capacitor' }),
);
vi.mock('@/platform/capacitor', () => ({ createCapacitorPlatform }));

const { createPlatform } = await import('@/platform/index');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createPlatform', () => {
  it('selects the web implementation when not running natively', async () => {
    isNativePlatform.mockReturnValue(false);
    const platform = await createPlatform();
    expect(platform).toEqual({ marker: 'web' });
    expect(createWebPlatform).toHaveBeenCalledTimes(1);
    expect(createCapacitorPlatform).not.toHaveBeenCalled();
  });

  it('selects the Capacitor implementation when running natively', async () => {
    isNativePlatform.mockReturnValue(true);
    const platform = await createPlatform();
    expect(platform).toEqual({ marker: 'capacitor' });
    expect(createCapacitorPlatform).toHaveBeenCalledTimes(1);
    expect(createWebPlatform).not.toHaveBeenCalled();
  });

  it('force: "web" overrides native detection', async () => {
    isNativePlatform.mockReturnValue(true);
    const platform = await createPlatform({ force: 'web' });
    expect(platform).toEqual({ marker: 'web' });
    expect(createCapacitorPlatform).not.toHaveBeenCalled();
  });

  it('?platform=web query override forces the web implementation', async () => {
    isNativePlatform.mockReturnValue(true);
    const original = globalThis.location;
    Object.defineProperty(globalThis, 'location', {
      value: { search: '?platform=web' },
      configurable: true,
    });
    try {
      const platform = await createPlatform();
      expect(platform).toEqual({ marker: 'web' });
      expect(createCapacitorPlatform).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(globalThis, 'location', { value: original, configurable: true });
    }
  });
});
