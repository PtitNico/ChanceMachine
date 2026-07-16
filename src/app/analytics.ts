/**
 * analytics.ts
 * ------------
 * Thin wrapper around GoatCounter's client-side JS API (the `<script data-goatcounter=...>` tag
 * in `index.html` loads it and automatically counts page views on its own - this file is only for
 * the one CUSTOM event this app tracks on top of that: installing the PWA). `window.goatcounter`
 * may not exist yet when this fires (the script hasn't finished loading, or is blocked outright by
 * an ad/tracker blocker) - every call here is written to just silently do nothing in that case,
 * since analytics is expendable but a throwing call must never be allowed to break the app.
 */

declare global {
  interface Window {
    goatcounter?: {
      count(options: { path: string; title?: string; event?: boolean }): void;
    };
  }
}

/** Fires once, the moment a visitor actually installs the PWA (accepts the browser's install
 *  prompt, or uses the browser menu's own "Install"/"Add to Home Screen" - both end in this same
 *  standard `appinstalled` event, so there's no need to hook the install prompt itself). */
export function trackPwaInstall(): void {
  window.addEventListener('appinstalled', () => {
    window.goatcounter?.count({ path: 'pwa-install', title: 'PWA install', event: true });
  });
}
