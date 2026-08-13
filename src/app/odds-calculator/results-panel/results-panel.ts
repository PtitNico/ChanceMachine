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
  /** The true JOINT probability every target is destroyed - see `chanceToDestroyAllTargets`'s own
   *  doc comment for why this is NOT simply the product of each target's own `finalDestroyChance`.
   *  Only ever read once `results().length > 1` (see the template), so `null` (while a computation
   *  is still in flight and no `results` exist yet) never actually reaches the page. */
  readonly chanceToDestroyAll = input<number | null>(null);
  /** True once a recompute has been running long enough to be worth telling the user about - see
   *  `OddsEngine`'s own doc comment for the delay. The gauges below keep showing the LAST result
   *  (dimmed), not blanked, while this is true - reassurance the app hasn't frozen, not a reset. */
  readonly calculating = input(false);
  /** 0-1, or `null` while nothing is in flight - see `computeSequenceOdds`'s own `onProgress` doc
   *  comment for why this can jump unevenly rather than advancing smoothly. */
  readonly progress = input<number | null>(null);
  /** Set whenever the most recent recompute failed instead of producing a result - see `OddsEngine.error`'s
   *  own doc comment. Shown as a banner replacing the "Calculating" overlay, over the dimmed last-known
   *  gauges (mostly obscured by the overlay's own near-opaque backdrop, not legibly "shown" - same
   *  underlying `readout__grid--calculating` treatment `calculating` itself gets, just relabeled). */
  readonly error = input<string | null>(null);
  /** True once the player has cancelled a still-running computation - see `OddsEngine.cancelled`'s
   *  own doc comment. Shown the same way `error` is (a banner over the dimmed last-known gauges,
   *  replacing "Calculating"), but with its own calmer styling and a Retry action - being cancelled
   *  is a deliberate player action, not a failure. */
  readonly cancelled = input(false);
  /** True whenever the CURRENT computation's own estimated complexity is high enough to be worth a
   *  heads-up - see `OddsEngine.slow`'s own doc comment. Shown as a small hint under the "Calculating"
   *  label itself (not a replacement for it - unlike `error`/`cancelled`, this doesn't change what
   *  state the overlay is in, just adds context to the SAME "Calculating" one). There is no hard cap
   *  behind this anymore: the computation runs regardless, this is purely a heads-up so the player can
   *  decide whether to wait, Cancel, or change the inputs. */
  readonly slow = input(false);
  /** Which target's own Details breakdown to open - always 0 with a single target. */
  readonly showDetails = output<number>();
  /** The player clicked "Cancel" on a still-running computation - see `OddsEngine.cancel`. */
  readonly cancel = output<void>();
  /** The player clicked "Retry" after cancelling - re-runs the exact same computation `cancel` had
   *  interrupted (the inputs haven't changed, so there's nothing for the parent to recompute from
   *  scratch - it just calls `OddsEngine.computeSequence` again with what it already has). */
  readonly retry = output<void>();

  protected readonly pct = pct;
}
