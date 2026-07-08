import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { SequenceResult } from '../../engine/sequence';
import { pct } from '../format.util';

@Component({
  selector: 'app-results-panel',
  standalone: true,
  templateUrl: './results-panel.html',
  styleUrls: ['./results-panel.css', '../shared/section.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ResultsPanel {
  readonly sequence = input.required<SequenceResult>();
  readonly showDetails = output<void>();

  protected readonly pct = pct;
}
