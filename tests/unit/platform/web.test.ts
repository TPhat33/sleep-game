// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createWebPlatform } from '@/platform/web';

function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

function stubWakeLock() {
  const releaseListeners: (() => void)[] = [];
  const sentinel = {
    released: false,
    addEventListener: (type: string, fn: () => void) => {
      if (type === 'release') releaseListeners.push(fn);
    },
    release: vi.fn((): Promise<void> => {
      sentinel.released = true;
      for (const fn of releaseListeners) fn();
      return Promise.resolve();
    }),
  };
  const requestMock = vi.fn((): Promise<typeof sentinel> => Promise.resolve(sentinel));
  Object.defineProperty(navigator, 'wakeLock', {
    value: { request: requestMock },
    configurable: true,
  });
  return { sentinel, requestMock };
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'wakeLock');
  Reflect.deleteProperty(navigator, 'mediaSession');
  Reflect.deleteProperty(navigator, 'audioSession');
  setVisibility('visible');
});

describe('createWebPlatform: brightness', () => {
  it('is unsupported on web', async () => {
    const platform = createWebPlatform();
    expect(platform.brightness.supported).toBe(false);
    await expect(platform.brightness.get()).resolves.toBeNull();
    await expect(platform.brightness.set(0.5)).resolves.toBeUndefined();
    await expect(platform.brightness.restore()).resolves.toBeUndefined();
  });
});

describe('createWebPlatform: wakeLock', () => {
  it('reports supported when navigator.wakeLock exists', () => {
    stubWakeLock();
    const platform = createWebPlatform();
    expect(platform.wakeLock.supported).toBe(true);
  });

  it('reports unsupported when navigator.wakeLock is absent', () => {
    const platform = createWebPlatform();
    expect(platform.wakeLock.supported).toBe(false);
  });

  it('re-acquires on becoming visible while the lock is wanted', async () => {
    const { requestMock, sentinel } = stubWakeLock();
    const platform = createWebPlatform();
    await platform.wakeLock.acquire();
    expect(requestMock).toHaveBeenCalledTimes(1);

    // The UA itself releases the sentinel when the document is hidden —
    // real Screen Wake Lock behavior, simulated here since jsdom doesn't do it.
    setVisibility('hidden');
    await sentinel.release();
    setVisibility('visible');
    await Promise.resolve();
    await Promise.resolve();

    expect(requestMock).toHaveBeenCalledTimes(2);
  });

  it('does not re-acquire after release()', async () => {
    const { requestMock } = stubWakeLock();
    const platform = createWebPlatform();
    await platform.wakeLock.acquire();
    await platform.wakeLock.release();

    setVisibility('hidden');
    setVisibility('visible');
    await Promise.resolve();
    await Promise.resolve();

    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(platform.wakeLock.held).toBe(false);
  });
});

describe('createWebPlatform: backgroundAudio', () => {
  it('activate sets audioSession.type when present and does not throw when absent', async () => {
    const platform = createWebPlatform();
    await expect(
      platform.backgroundAudio.activate({ title: 'Firefly Pond' }),
    ).resolves.toBeUndefined();

    Object.defineProperty(navigator, 'audioSession', {
      value: { type: 'auto' },
      configurable: true,
    });
    await platform.backgroundAudio.activate({ title: 'Firefly Pond' });
    expect((navigator as Navigator & { audioSession: { type: string } }).audioSession.type).toBe(
      'playback',
    );
  });

  it("mode is 'none' without navigator.mediaSession", () => {
    const platform = createWebPlatform();
    expect(platform.backgroundAudio.mode).toBe('none');
  });

  it("mode is 'web-media-session' with navigator.mediaSession", () => {
    Object.defineProperty(navigator, 'mediaSession', {
      value: { metadata: null, playbackState: 'none', setActionHandler: vi.fn() },
      configurable: true,
    });
    const platform = createWebPlatform();
    expect(platform.backgroundAudio.mode).toBe('web-media-session');
  });
});

describe('createWebPlatform: dispose', () => {
  it('releases the wake lock and deactivates background audio', async () => {
    const { sentinel } = stubWakeLock();
    const platform = createWebPlatform();
    await platform.wakeLock.acquire();
    await platform.dispose();
    expect(sentinel.release).toHaveBeenCalled();
  });
});

describe('createWebPlatform: shareFile', () => {
  it('triggers a Blob download via a temporary anchor, with no network call', async () => {
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => 'blob:fake-url');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      /* jsdom has no real navigation; just record the call */
    });

    const platform = createWebPlatform();
    await platform.shareFile('firefly-pond-export.json', '{"sessions":[]}');

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const [blobArg] = createObjectURL.mock.calls[0] as [Blob];
    expect(blobArg.type).toBe('application/json');
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');

    clickSpy.mockRestore();
    Reflect.deleteProperty(URL, 'createObjectURL');
    Reflect.deleteProperty(URL, 'revokeObjectURL');
  });

  it('logs rather than throws if the download fails to trigger', async () => {
    const log = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', {
      value: () => {
        throw new Error('blocked');
      },
      configurable: true,
    });

    const platform = createWebPlatform({ log });
    await expect(platform.shareFile('x.json', '{}')).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('shareFile'));

    Reflect.deleteProperty(URL, 'createObjectURL');
  });
});
