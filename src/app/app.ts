import { Component, inject } from '@angular/core';
import { trackPwaInstall } from './analytics';
import { OddsCalculator } from './odds-calculator/odds-calculator';
import { PwaInstall } from './pwa-install';
import { PwaUpdate } from './pwa-update';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [OddsCalculator],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  constructor() {
    // Eagerly constructs the root-provided singleton (rather than waiting for PwaInstallBanner to
    // inject it later) so its `beforeinstallprompt` listener is registered as early as possible -
    // see PwaInstall's own doc comment. Never read directly here; PwaInstallBanner injects the
    // same instance.
    inject(PwaInstall);
    // Same reasoning: eagerly constructs the singleton so it starts checking for a new deployed
    // version immediately, rather than waiting for something else to inject it later.
    inject(PwaUpdate);

    updateAppHeight();
    const viewport = window.visualViewport;
    (viewport ?? window).addEventListener('resize', updateAppHeight);
    trackPwaInstall();
  }
}

/**
 * Sets `--app-height` (consumed by `.page` in app.css) from the actual visible viewport height.
 * `window.visualViewport`, when available, tracks address-bar show/hide and on-screen-keyboard
 * changes more reliably than the CSS `100dvh` unit does on some Android WebView versions - that
 * gap is what caused the installed PWA's fixed layout to end up mis-sized after a pull-to-refresh
 * reload (see the `overscroll-behavior-y` comment in styles.css for the bug this replaces).
 */
function updateAppHeight(): void {
  const height = window.visualViewport?.height ?? window.innerHeight;
  document.documentElement.style.setProperty('--app-height', `${height}px`);
}
