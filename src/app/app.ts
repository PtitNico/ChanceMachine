import { Component } from '@angular/core';
import { trackPwaInstall } from './analytics';
import { OddsCalculator } from './odds-calculator/odds-calculator';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [OddsCalculator],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  constructor() {
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
