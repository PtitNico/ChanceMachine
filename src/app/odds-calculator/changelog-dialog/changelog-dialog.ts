import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, ViewChild } from '@angular/core';
import { HAS_SEEN_ABOUT_KEY } from '../about-dialog/about-dialog';
import { CHANGELOG, LATEST_CHANGELOG_DATE } from './changelog.data';

/** Set in localStorage whenever this dialog auto-opens (or is closed after auto-opening) so the
 *  same "what's new" entries never auto-open twice - see `ngAfterViewInit`. */
const LAST_SEEN_CHANGELOG_DATE_KEY = 'chancemachine.lastSeenChangelogDate';

@Component({
  selector: 'app-changelog-dialog',
  standalone: true,
  templateUrl: './changelog-dialog.html',
  // Shared partials first, this component's own file last - see target-panel.ts for why.
  styleUrls: ['../shared/dialog.css', '../shared/icon-btn.css', './changelog-dialog.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChangelogDialog implements AfterViewInit {
  protected readonly entries = CHANGELOG;

  @ViewChild('dialog') private dialogRef?: ElementRef<HTMLDialogElement>;

  /**
   * Auto-opens once whenever entries have been added since a visitor last saw this dialog (opened
   * manually or auto-opened) - but never on a visitor's very first ever load. On that first load,
   * `AboutDialog` already covers "what is this app", and the full history of "what's new" would be
   * noise, not news, to someone who's never used any earlier version - so that visit just silently
   * records the current latest date without ever showing the pop-up, exactly as if they'd already
   * seen it. Telling the two cases apart means reading `HAS_SEEN_ABOUT_KEY`, which `AboutDialog`
   * writes from its OWN `ngAfterViewInit` - deferring the read to a microtask (rather than reading
   * it directly here) means this always runs AFTER every sibling's `ngAfterViewInit` for this
   * change-detection pass has already returned (they're all synchronous; none of them yield to a
   * microtask), so the check below is correct regardless of `<app-about-dialog>`'s position
   * relative to this component in the template, instead of silently depending on it staying first.
   */
  ngAfterViewInit(): void {
    queueMicrotask(() => {
      const hadAlreadySeenAbout = !!localStorage.getItem(HAS_SEEN_ABOUT_KEY);
      if (!hadAlreadySeenAbout) {
        localStorage.setItem(LAST_SEEN_CHANGELOG_DATE_KEY, LATEST_CHANGELOG_DATE);
        return;
      }
      const lastSeen = localStorage.getItem(LAST_SEEN_CHANGELOG_DATE_KEY) ?? '';
      if (lastSeen >= LATEST_CHANGELOG_DATE) {
        return;
      }
      localStorage.setItem(LAST_SEEN_CHANGELOG_DATE_KEY, LATEST_CHANGELOG_DATE);
      this.open();
    });
  }

  open(): void {
    this.dialogRef?.nativeElement.showModal();
  }

  close(): void {
    this.dialogRef?.nativeElement.close();
  }

  /** Native <dialog> reports a click anywhere in the viewport while open; only the ::backdrop click has the dialog itself as target. */
  protected closeOnBackdropClick(event: MouseEvent, dialog: HTMLDialogElement): void {
    if (event.target === dialog) {
      dialog.close();
    }
  }
}
