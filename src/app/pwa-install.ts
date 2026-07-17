import { Injectable, signal } from '@angular/core';

/** The non-standard `beforeinstallprompt` event - Chromium-only, not part of the DOM spec, so
 *  it's not in TypeScript's own lib typings. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * Wraps `beforeinstallprompt` so the app can offer its own install banner at a moment of the
 * visitor's choosing, instead of only whatever install affordance the browser shows on its own
 * (a mobile Chrome mini-infobar, a desktop omnibox icon, or nothing at all depending on the
 * browser) - see https://web.dev/learn/pwa/installation-prompt. Only Chromium-based browsers fire
 * this event at all; Safari (desktop and iOS) never does, so `installable` simply stays `false`
 * there and `PwaInstallBanner` renders nothing - no separate manual "Add to Home Screen"
 * instructions for those browsers (yet - see the functional documentation's roadmap).
 */
@Injectable({ providedIn: 'root' })
export class PwaInstall {
  private deferredPrompt: BeforeInstallPromptEvent | null = null;

  readonly installable = signal(false);

  constructor() {
    // Already running as the installed app - there's nothing to offer, and `beforeinstallprompt`
    // wouldn't fire again for an already-installed PWA anyway. Wrapped in try/catch: this
    // project's Vitest/Node test environment doesn't provide a working `window.matchMedia`
    // (`app.spec.ts` constructs this service - via `App`'s own eager `inject()` - without ever
    // rendering it into a real browser), and a missing API here should just mean "assume not
    // installed" rather than crash the app - the same "fail safe, don't fail loud" pattern
    // `ChangelogDialog` already uses for its own `localStorage` access.
    const isStandalone = (() => {
      try {
        return window.matchMedia('(display-mode: standalone)').matches;
      } catch {
        return false;
      }
    })();
    if (isStandalone) {
      return;
    }

    window.addEventListener('beforeinstallprompt', (event) => {
      // Suppresses the browser's own install-promotion UI (e.g. Chrome's mobile mini-infobar) in
      // favor of this app's own install banner, triggered whenever the visitor chooses.
      event.preventDefault();
      this.deferredPrompt = event as BeforeInstallPromptEvent;
      this.installable.set(true);
    });

    // Covers installing through some route OTHER than this service's own `install()` below - a
    // browser's separate omnibox install icon, for instance, isn't gated by the `preventDefault()`
    // above, since accepting it doesn't go through this captured event at all.
    window.addEventListener('appinstalled', () => {
      this.deferredPrompt = null;
      this.installable.set(false);
    });
  }

  /** A captured `beforeinstallprompt` event can only be shown once - this always clears it
   *  afterward (accepted or dismissed either way), matching the banner's own disappearance. */
  async install(): Promise<void> {
    const prompt = this.deferredPrompt;
    if (!prompt) {
      return;
    }
    this.deferredPrompt = null;
    this.installable.set(false);
    await prompt.prompt();
    await prompt.userChoice;
  }
}
