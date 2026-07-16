import { AfterViewInit, ChangeDetectionStrategy, Component, ViewChild } from '@angular/core';
import { DialogShell } from '../dialog-shell/dialog-shell';

/** Set in localStorage the first time this dialog auto-opens itself, so it never does so again
 *  on the same device/browser - see `ngAfterViewInit`. Exported so `ChangelogDialog` can tell a
 *  visitor's very first ever load (About auto-opens, this key is about to be set for the first
 *  time) apart from a returning one (see its own doc comment for why that distinction matters). */
export const HAS_SEEN_ABOUT_KEY = 'chancemachine.hasSeenAbout';

@Component({
  selector: 'app-about-dialog',
  standalone: true,
  imports: [DialogShell],
  templateUrl: './about-dialog.html',
  styleUrls: ['./about-dialog.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AboutDialog implements AfterViewInit {
  @ViewChild('shell') private shell?: DialogShell;

  /** Auto-opens itself once per device/browser, the very first time the app is ever loaded -
   *  a new visitor gets a quick explanation of what the app does without having to find the
   *  menu first; anyone who's seen it before (including someone who closed it instantly without
   *  reading it - this only tracks "has it auto-opened", not "did they read it") never gets
   *  interrupted by it again. Manually opening it from the menu never touches this flag. */
  ngAfterViewInit(): void {
    if (localStorage.getItem(HAS_SEEN_ABOUT_KEY)) {
      return;
    }
    localStorage.setItem(HAS_SEEN_ABOUT_KEY, '1');
    this.open();
  }

  open(): void {
    this.shell?.open();
  }
}
