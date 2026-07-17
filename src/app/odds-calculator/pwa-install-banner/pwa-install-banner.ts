import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { trackPwaInstallDismiss } from '../../analytics';
import { PwaInstall } from '../../pwa-install';

/**
 * A dismissible banner offering to install the PWA, shown between the header and the Target
 * section - visible on its own rather than tucked away in the hamburger menu, since
 * `beforeinstallprompt` is a one-shot opportunity worth surfacing directly.
 */
@Component({
  selector: 'app-pwa-install-banner',
  standalone: true,
  templateUrl: './pwa-install-banner.html',
  styleUrls: ['../shared/icon-btn.css', './pwa-install-banner.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PwaInstallBanner {
  private readonly pwaInstall = inject(PwaInstall);

  /** Session-only: dismissing just hides the banner until the next page load, matching the
   *  literal "hide it" ask rather than the About/Changelog dialogs' persisted "seen it" pattern. */
  private readonly dismissed = signal(false);

  protected readonly visible = computed(() => this.pwaInstall.installable() && !this.dismissed());

  protected install(): void {
    this.pwaInstall.install().then(() => {});
  }

  protected dismiss(): void {
    this.dismissed.set(true);
    trackPwaInstallDismiss();
  }
}
