import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
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
  readonly showDetails = output<void>();

  protected readonly pct = pct;
}
