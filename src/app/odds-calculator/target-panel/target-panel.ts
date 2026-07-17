import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { EffectTags } from '../effect-tags/effect-tags';
import { MiniFieldSelect } from '../mini-field-select/mini-field-select';
import { toNumber } from '../select.util';
import { ARM_OPTIONS, BOXES_OPTIONS, DEF_OPTIONS, TargetState, targetSummary } from './target-panel.model';

@Component({
  selector: 'app-target-panel',
  standalone: true,
  imports: [FormsModule, EffectTags, MiniFieldSelect],
  templateUrl: './target-panel.html',
  // Shared partials first, this component's own file last: with equal-specificity class
  // selectors (e.g. `.console` here vs. `.console--attacks` in the parent), Angular
  // concatenates styleUrls in order and the later one wins a tie - local overrides must
  // always come after the shared rules they override.
  styleUrls: ['../shared/section.css', '../shared/scrollable-row.css', '../shared/icon-btn.css', './target-panel.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TargetPanel {
  readonly target = input.required<TargetState>();
  readonly openProfile = output<void>();

  protected readonly defOptions = DEF_OPTIONS;
  protected readonly armOptions = ARM_OPTIONS;
  protected readonly boxesOptions = BOXES_OPTIONS;
  protected readonly targetSummary = targetSummary;

  protected readonly toNumber = toNumber;
  /** DEF additionally accepts the 'KD' sentinel, which must not be converted to a number. */
  protected readonly parseDef = (raw: string): number | 'KD' => (raw === 'KD' ? 'KD' : Number(raw));
}
