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
  readonly showDetails = output<void>();

  protected readonly pct = pct;

  /** `expectedBoxesRemaining` is already an UNCONDITIONAL expectation that treats a destroyed
   *  target as 0 boxes remaining (see SequenceStepResult), so `boxesInitial - that` is exactly
   *  the expected total damage dealt over the whole sequence - no separate engine field needed. */
  protected readonly averageDamage = computed(() => {
    const lastStep = this.sequence().steps.at(-1);
    return lastStep ? this.boxesInitial() - lastStep.expectedBoxesRemaining : undefined;
  });
}
