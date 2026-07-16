import { ChangeDetectionStrategy, Component, ViewChild, input } from '@angular/core';
import { SequenceStepResult } from '../../engine/sequence';
import { DialogShell } from '../dialog-shell/dialog-shell';
import { pct } from '../format.util';
import { DamagePoint } from './details-dialog.model';

@Component({
  selector: 'app-details-dialog',
  standalone: true,
  imports: [DialogShell],
  templateUrl: './details-dialog.html',
  styleUrls: ['./details-dialog.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DetailsDialog {
  readonly steps = input.required<SequenceStepResult[]>();
  readonly damagePoints = input.required<DamagePoint[]>();
  readonly maxDamageProbability = input.required<number>();

  protected readonly pct = pct;

  @ViewChild('shell') private shell?: DialogShell;

  open(): void {
    this.shell?.open();
  }
}
