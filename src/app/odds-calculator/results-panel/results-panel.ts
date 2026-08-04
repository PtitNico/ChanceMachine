import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TargetSequenceResult } from '../../engine/sequence';
import { pct } from '../format.util';

@Component({
  selector: 'app-results-panel',
  standalone: true,
  templateUrl: './results-panel.html',
  // Shared partials first, this component's own file last - see target-panel.ts for why.
  styleUrls: ['../shared/section.css', '../shared/icon-btn.css', './results-panel.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ResultsPanel {
  /** One entry per target, in order - see `computeMultiTargetSequenceOdds`. */
  readonly results = input.required<TargetSequenceResult[]>();
  readonly targetNames = input.required<string[]>();
  /** Same order as `results`/`targetNames` - see `OddsCalculator.averageDamageByTarget`'s own doc
   *  comment for why this is computed by the orchestrator rather than derived here from
   *  `expectedBoxesRemaining` (this component doesn't know each target's own `boxesInitial`, and
   *  more importantly the naive `boxesInitial - expectedBoxesRemaining` subtraction silently drops
   *  mass that never reached a given target at all). */
  readonly averageDamageByTarget = input.required<number[]>();
  /** True once a recompute has been running long enough to be worth telling the user about - see
   *  `OddsEngine`'s own doc comment for the delay. The gauges below keep showing the LAST result
   *  (dimmed), not blanked, while this is true - reassurance the app hasn't frozen, not a reset. */
  readonly calculating = input(false);
  /** 0-1, or `null` while nothing is in flight - see `computeSequenceOdds`'s own `onProgress` doc
   *  comment for why this can jump unevenly rather than advancing smoothly. */
  readonly progress = input<number | null>(null);
  /** Which target's own Details breakdown to open - always 0 with a single target. */
  readonly showDetails = output<number>();

  protected readonly pct = pct;
}
