import { ChangeDetectionStrategy, Component, ViewChild, computed, input, signal } from '@angular/core';
import { DialogShell } from '../dialog-shell/dialog-shell';
import { pct } from '../format.util';
import { DamagePoint, FocusStrategyBlock, ShotRow } from './details-dialog.model';

/** "Normal" (internally `'exact'` - the UI label reads better as the OPPOSITE of "At least" than
 *  as a claim about precision) shows P(damage == X) as originally computed; "At least" shows
 *  P(damage >= X) - a cumulative-from-the-top view of the SAME distribution, more useful for "will
 *  this at least knock the target down to N boxes" questions than reading off a run of
 *  individually-small bars. */
export type DistributionMode = 'exact' | 'atLeast';

/** Step-by-step breakdown + damage distribution, scoped to one target at a time. With a single
 *  target this looks exactly as it always has (no tab strip at all); with more than one, a tab
 *  strip at the top (one per target, showing its own destroy chance AND average damage - the
 *  Results panel only shows the joint "chance to destroy all targets" figure once there's more
 *  than one target, so this tab strip is the only place a per-target breakdown is still visible)
 *  lets the player switch which target's own breakdown is shown below. */
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
  readonly destroyChanceByTarget = input.required<number[]>();
  readonly averageDamageByTarget = input.required<number[]>();
  /** One block per Focus-enabled attacker, shared across every target (Focus is one pool for the
   *  whole sequence - see odds-calculator.ts's own doc comment) rather than per-target like
   *  everything else in this dialog. Empty whenever no attacker has Focus active. */
  readonly focusStrategyBlocks = input.required<FocusStrategyBlock[]>();

  protected readonly pct = pct;
  protected readonly selectedIndex = signal(0);
  protected readonly distributionMode = signal<DistributionMode>('exact');

  /** `damagePointsByTarget()[selectedIndex()]` is already sorted ascending by `damage` - "at least"
   *  cumulates from the top down (`P(>= X) = P(== X) + P(>= X+1)`), so every row's own label
   *  becomes "X+" too, including the top row (whether or not it was already a genuine "boxesInitial+"
   *  destroy bucket - either way, "at least" is the honest reading of a cumulative value). */
  protected readonly displayedDamagePoints = computed<DamagePoint[]>(() => {
    const points = this.damagePointsByTarget()[this.selectedIndex()] ?? [];
    if (this.distributionMode() === 'exact') return points;
    let cumulative = 0;
    const result: DamagePoint[] = [];
    for (let i = points.length - 1; i >= 0; i--) {
      cumulative += points[i].probability;
      result.unshift({ ...points[i], probability: cumulative, label: `${points[i].damage}+` });
    }
    return result;
  });

  /** Scales the distribution's own bars - computed from whichever points are actually on screen
   *  (not just the "exact" ones) since "at least" mode's own largest bar is always its FIRST point
   *  (P(>= lowest shown damage)), not necessarily the same point "exact" mode's own max was at. */
  protected readonly maxDisplayedProbability = computed<number>(() =>
    Math.max(...this.displayedDamagePoints().map((p) => p.probability), 0.0001)
  );

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

  protected setDistributionMode(mode: DistributionMode): void {
    this.distributionMode.set(mode);
  }
}
