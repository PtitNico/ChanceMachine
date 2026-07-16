import { AfterViewInit, ChangeDetectionStrategy, Component, ViewChild } from '@angular/core';
import { HAS_SEEN_ABOUT_KEY } from '../about-dialog/about-dialog';
import { DialogShell } from '../dialog-shell/dialog-shell';
import { CHANGELOG, LATEST_CHANGELOG_DATE } from './changelog.data';

/** Set in localStorage whenever this dialog auto-opens (or is closed after auto-opening) so the
 *  same "what's new" entries never auto-open twice - see `ngAfterViewInit`. */
const LAST_SEEN_CHANGELOG_DATE_KEY = 'chancemachine.lastSeenChangelogDate';

/**
 * Whether `HAS_SEEN_ABOUT_KEY` was already set BEFORE this page load - i.e. whether `AboutDialog`
 * is about to auto-open itself for the very first time on this load, or already did on some
 * earlier one. Wrapped in try/catch: this project's Vitest/Node test environment doesn't provide
 * a working `localStorage` early enough for `app.spec.ts` (`TestBed.createComponent(App)` runs
 * every component's constructor without ever calling `fixture.detectChanges()`, so this executes
 * even though `ngAfterViewInit` never does) - a real browser always has a working `localStorage`,
 * so the catch branch only ever matters for that test; failing safe by treating "can't tell" the
 * same as "already seen" just means never auto-opening as a side effect of not knowing.
 */
function hadAlreadySeenAbout(): boolean {
  try {
    return !!localStorage.getItem(HAS_SEEN_ABOUT_KEY);
  } catch {
    return true;
  }
}

@Component({
  selector: 'app-changelog-dialog',
  standalone: true,
  imports: [DialogShell],
  templateUrl: './changelog-dialog.html',
  styleUrls: ['./changelog-dialog.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChangelogDialog implements AfterViewInit {
  protected readonly entries = CHANGELOG;

  @ViewChild('shell') private shell?: DialogShell;

  // Captured in the constructor (a field initializer runs as part of it), NOT read directly
  // inside `ngAfterViewInit` below: Angular constructs every component in a view tree - running
  // every field initializer/constructor body - before running ANY of their `ngAfterViewInit`
  // hooks, a strict phase separation rather than an ordering convention. Reading this here is
  // therefore guaranteed to see the value from BEFORE this page load's dialogs ran, regardless of
  // `<app-about-dialog>`'s position relative to this component in `odds-calculator.html` -
  // reading it directly inside `ngAfterViewInit` instead would see `AboutDialog`'s OWN
  // `ngAfterViewInit` having already flipped it to "seen" a moment earlier on a visitor's very
  // first ever load, which would incorrectly read as "not their first visit" every single time.
  private readonly wasAlreadySeenAbout = hadAlreadySeenAbout();

  /**
   * Auto-opens once whenever entries have been added since a visitor last saw this dialog (opened
   * manually or auto-opened) - but never on a visitor's very first ever load. On that first load,
   * `AboutDialog` already covers "what is this app", and the full history of "what's new" would be
   * noise, not news, to someone who's never used any earlier version - so that visit just silently
   * records the current latest date without ever showing the pop-up, exactly as if they'd already
   * seen it.
   */
  ngAfterViewInit(): void {
    if (!this.wasAlreadySeenAbout) {
      localStorage.setItem(LAST_SEEN_CHANGELOG_DATE_KEY, LATEST_CHANGELOG_DATE);
      return;
    }
    const lastSeen = localStorage.getItem(LAST_SEEN_CHANGELOG_DATE_KEY) ?? '';
    if (lastSeen >= LATEST_CHANGELOG_DATE) {
      return;
    }
    localStorage.setItem(LAST_SEEN_CHANGELOG_DATE_KEY, LATEST_CHANGELOG_DATE);
    this.open();
  }

  open(): void {
    this.shell?.open();
  }
}
