import { ChangeDetectionStrategy, Component, ElementRef, ViewChild } from '@angular/core';

@Component({
  selector: 'app-about-dialog',
  standalone: true,
  templateUrl: './about-dialog.html',
  // Shared partials first, this component's own file last - see target-panel.ts for why.
  styleUrls: ['../shared/dialog.css', '../shared/icon-btn.css', './about-dialog.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AboutDialog {
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
