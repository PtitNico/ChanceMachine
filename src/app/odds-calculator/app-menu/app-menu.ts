import { ChangeDetectionStrategy, Component, ElementRef, ViewChild, output, signal } from '@angular/core';

/**
 * The hamburger menu in the header's top-right corner. A lightweight anchored dropdown rather
 * than a native `<dialog>` (unlike every other pop-up in this app) - it's a short list of actions,
 * not a form or a breakdown, so a full-screen modal backdrop would be heavier than the content
 * warrants. It owns none of the actions itself: Reset needs the target/attack-sequence state that
 * lives in `OddsCalculator`, and About/Feedback are their own dialog components (same pattern as
 * `TargetPanel`'s `openProfile` output triggering `TargetProfileDialog` one level up) - this
 * component only emits which one was picked and closes itself.
 */
@Component({
  selector: 'app-menu',
  standalone: true,
  templateUrl: './app-menu.html',
  styleUrls: ['../shared/icon-btn.css', './app-menu.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppMenu {
  readonly reset = output<void>();
  readonly openAbout = output<void>();
  readonly openFeedback = output<void>();

  protected readonly isOpen = signal(false);

  @ViewChild('menuRoot') private menuRoot?: ElementRef<HTMLElement>;

  protected toggle(): void {
    this.isOpen.update((open) => !open);
  }

  protected close(): void {
    this.isOpen.set(false);
  }

  protected onReset(): void {
    this.reset.emit();
    this.close();
  }

  protected onAbout(): void {
    this.openAbout.emit();
    this.close();
  }

  protected onFeedback(): void {
    this.openFeedback.emit();
    this.close();
  }

  /** Closes the dropdown on any click outside it - there's no `::backdrop` to catch this the way
   *  the app's native `<dialog>` pop-ups do (see `closeOnBackdropClick` elsewhere), so this walks
   *  the click's target up against the menu's own root element instead. The click that opens the
   *  menu (on the trigger button, inside `menuRoot`) also reaches this handler via bubbling, but
   *  since its target is contained within `menuRoot` it's correctly treated as "inside". */
  protected onDocumentClick(event: MouseEvent): void {
    if (this.isOpen() && this.menuRoot && !this.menuRoot.nativeElement.contains(event.target as Node)) {
      this.close();
    }
  }
}
