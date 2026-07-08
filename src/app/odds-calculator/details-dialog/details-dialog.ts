import { ChangeDetectionStrategy, Component, ElementRef, ViewChild, input } from '@angular/core';
import { SequenceStepResult } from '../../engine/sequence';
import { pct } from '../format.util';
import { DamagePoint } from './details-dialog.model';

@Component({
  selector: 'app-details-dialog',
  standalone: true,
  templateUrl: './details-dialog.html',
  styleUrls: ['./details-dialog.css', '../shared/dialog.css', '../shared/icon-btn.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DetailsDialog {
  readonly steps = input.required<SequenceStepResult[]>();
  readonly damagePoints = input.required<DamagePoint[]>();
  readonly maxDamageProbability = input.required<number>();

  protected readonly pct = pct;

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
