import { Injectable, inject } from '@angular/core';
import { SwUpdate } from '@angular/service-worker';

/**
 * Forces the app onto the latest deployed version on every launch, instead of leaving a player on
 * a stale cached build (wrong odds from an outdated engine) until they notice and manually
 * refresh. `checkForUpdate()` kicks off the check as soon as the service worker is ready;
 * `versionUpdates` fires `VERSION_READY` once the new version has finished downloading, at which
 * point it's activated and the page reloads onto it.
 */
@Injectable({ providedIn: 'root' })
export class PwaUpdate {
  private readonly swUpdate = inject(SwUpdate);

  constructor() {
    if (!this.swUpdate.isEnabled) {
      return;
    }

    this.swUpdate.versionUpdates.subscribe((event) => {
      if (event.type === 'VERSION_READY') {
        this.swUpdate.activateUpdate().then(() => location.reload());
      }
    });

    this.swUpdate.checkForUpdate();
  }
}
