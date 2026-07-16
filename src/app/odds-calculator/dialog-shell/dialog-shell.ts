import { ChangeDetectionStrategy, Component, ElementRef, ViewChild, input } from '@angular/core';

/**
 * Shared chrome for every pop-up in this app: the native `<dialog>`, its
 * click-outside-the-content-to-close handling, and the header (title + close button) - the one
 * block of markup that used to be hand-copied, verbatim, into all six dialog components (About,
 * Changelog, Feedback, Effects, Target profile, Details), along with the `open()`/`close()`/
 * `closeOnBackdropClick()` methods behind it. Each dialog component now projects its own body
 * content into this shell instead of owning the native element directly - callers OUTSIDE those
 * components (the orchestrator's template, `AppMenu`) don't change at all, since every dialog
 * still exposes its own public `open()` the same way it always did, just delegating to `#shell`
 * internally. There's no equivalent public `close()` left on any of them: nothing outside a
 * dialog's own template ever called it (checked - every call site was the dialog's own close/
 * done/cancel button), so each dialog's projected content just calls `shell.close()` directly via
 * the `#shell` template reference variable, which content projection keeps in scope.
 *
 * `[wide]` is the `dialog--wide` width modifier (Details). `[framed]` switches on the "fixed
 * header/footer, only the middle scrolls" layout (Effects, Target profile) - see
 * `shared/dialog-sections.css` for the CSS this drives. A framed consumer should mark its own
 * footer content with the `dialogActions` attribute so it projects into the slot reserved for it;
 * everything else projects into the default slot, wrapped in `.dialog__body` (the part that
 * scrolls) automatically when framed. A non-framed consumer's `dialogActions` content still works
 * the same way (Feedback) - it just isn't inside a flex column, so the slot's `flex-shrink: 0` is
 * simply a no-op there.
 */
@Component({
  selector: 'app-dialog-shell',
  standalone: true,
  templateUrl: './dialog-shell.html',
  // Shared partials first, this component's own file last - see target-panel.ts for why.
  styleUrls: ['../shared/dialog.css', '../shared/icon-btn.css', '../shared/dialog-sections.css', './dialog-shell.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DialogShell {
  readonly title = input.required<string>();
  readonly wide = input(false);
  readonly framed = input(false);

  @ViewChild('dialog') private dialogRef?: ElementRef<HTMLDialogElement>;

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
