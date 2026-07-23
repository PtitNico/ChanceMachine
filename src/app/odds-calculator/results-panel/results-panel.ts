import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { SequenceResult } from '../../engine/sequence';
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
  readonly sequence = input.required<SequenceResult>();
  readonly boxesInitial = input.required<number>();
  /** True once a recompute has been running long enough to be worth telling the user about - see
   *  `OddsEngine`'s own doc comment for the delay. The gauges below keep showing the LAST result
   *  (dimmed), not blanked, while this is true - reassurance the app hasn't frozen, not a reset. */
  readonly calculating = input(false);
  /** 0-1, or `null` while nothing is in flight - see `computeSequenceOdds`'s own `onProgress` doc
   *  comment for why this can jump unevenly rather than advancing smoothly. */
  readonly progress = input<number | null>(null);
  readonly showDetails = output<void>();

  protected readonly pct = pct;

  /** `expectedBoxesRemaining` is already an UNCONDITIONAL expectation that treats a destroyed
   *  target as 0 boxes remaining (see SequenceStepResult), so `boxesInitial - that` is exactly
   *  the expected total damage dealt over the whole sequence - no separate engine field needed.
   *  `expectedBoxesRemaining` can never legitimately exceed `boxesInitial` (damage is never
   *  negative), but summing many small floating-point probability terms can leave it a hair above
   *  (e.g. `15.000000000000002`), which would otherwise render as "-0.0" (`(-1e-15).toFixed(1)`
   *  keeps the minus sign) - `Math.max(0, ...)` clamps that noise away rather than exposing it. */
  protected readonly averageDamage = computed(() => {
    const lastStep = this.sequence().steps.at(-1);
    return lastStep ? Math.max(0, this.boxesInitial() - lastStep.expectedBoxesRemaining) : undefined;
  });
}
