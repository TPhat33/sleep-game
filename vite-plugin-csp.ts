import type { Plugin } from 'vite';

/**
 * Injects a build-only Content-Security-Policy meta tag.
 *
 * `'self'` covers `capacitor://localhost` (iOS) and `https://localhost` (Android),
 * the origins Capacitor serves the app from. Build-only so dev HMR (which needs
 * inline/eval scripts and a websocket) is unaffected.
 */
export function cspPlugin(): Plugin {
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob: mediastream:",
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
  ].join('; ');

  return {
    name: 'firefly-pond-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<head>',
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}">`,
      );
    },
  };
}
