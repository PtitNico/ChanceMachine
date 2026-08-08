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

/** Fires when a visitor dismisses the install banner (the ✕ button) without installing - lets the
 *  banner's decline rate be compared against `pwa-install` above. Browser/system/device/location
 *  aren't passed explicitly: GoatCounter's collector derives all of that itself, from the request's
 *  User-Agent and IP, for every counted hit (pageview or custom event alike) - same as it already
 *  does for the automatic page-view counting `index.html`'s script tag sets up. */
export function trackPwaInstallDismiss(): void {
  window.goatcounter?.count({ path: 'pwa-install-dismiss', title: 'PWA install banner dismissed', event: true });
}

/** The last sequence configuration (see `serializeFeedbackData`) a `details-open` event actually
 *  fired for - `trackDetailsOpen` skips re-firing when the CURRENT config is identical, so
 *  repeatedly opening/closing the Details pop-up without changing anything doesn't inflate the
 *  count. Deliberately module-level (not per-component) - resets naturally on a page reload, which
 *  is exactly when a fresh "first open" SHOULD fire again. */
let lastTrackedDetailsData: string | undefined;

/** Fires when the Details pop-up opens, carrying the current targets/attackers/weapons config (see
 *  `serializeFeedbackData`) as the event's `title` - `path` stays the fixed, aggregatable event
 *  name `pwa-install`/`pwa-install-dismiss` already use, rather than a unique-per-config path,
 *  since GoatCounter's own dashboard groups hits BY path - a unique path per call would defeat that
 *  grouping and scatter this into one distinct "page" per configuration. */
export function trackDetailsOpen(data: string): void {
  if (data === lastTrackedDetailsData) return;
  lastTrackedDetailsData = data;
  window.goatcounter?.count({ path: 'details-open', title: data, event: true });
}
