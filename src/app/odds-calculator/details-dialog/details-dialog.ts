import { ChangeDetectionStrategy, Component, ViewChild, input, signal } from '@angular/core';
import { DialogShell } from '../dialog-shell/dialog-shell';
import { pct } from '../format.util';
import { DamagePoint, ShotRow } from './details-dialog.model';

/** Step-by-step breakdown + damage distribution, scoped to one target at a time. With a single
 *  target this looks exactly as it always has (no tab strip at all); with more than one, a tab
 *  strip at the top (one per target, showing its own destroy/engagement chance) lets the player
 *  switch which target's own breakdown is shown below - see `sequence.ts`'s "Multiple targets"
 *  module doc comment section for what `engagementChance` means. */
@Component({
  selector: 'app-details-dialog',
  standalone: true,
  imports: [DialogShell],
  templateUrl: './details-dialog.html',
  styleUrls: ['./details-dialog.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DetailsDialog {
  /** One entry per target, in the SAME order throughout every input here. */
  readonly targetNames = input.required<string[]>();
  readonly shotRowsByTarget = input.required<ShotRow[][]>();
  readonly damagePointsByTarget = input.required<DamagePoint[][]>();
  readonly maxDamageProbabilityByTarget = input.required<number[]>();
  readonly destroyChanceByTarget = input.required<number[]>();
  /** Chance this target is even engaged at all - see `TargetSequenceResult.engagementChance`'s own
   *  doc comment. Always 1 for the first target. */
  readonly engagementChanceByTarget = input.required<number[]>();

  protected readonly pct = pct;
  protected readonly selectedIndex = signal(0);

  @ViewChild('shell') private shell?: DialogShell;

  /** `targetIndex` defaults to 0 (the first target) - callers that already know which target the
   *  player cares about (e.g. clicking a specific row in the Results panel's per-target list) pass
   *  it explicitly instead. */
  open(targetIndex = 0): void {
    this.selectedIndex.set(targetIndex);
    this.shell?.open();
  }

  protected selectTarget(index: number): void {
    this.selectedIndex.set(index);
  }
}
