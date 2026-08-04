import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { EditableName } from '../editable-name/editable-name';
import { EffectTags } from '../effect-tags/effect-tags';
import { MiniFieldSelect } from '../mini-field-select/mini-field-select';
import { toNumber } from '../select.util';
import { ARM_OPTIONS, BOXES_OPTIONS, DEF_OPTIONS, Target, targetSummary } from './target-panel.model';

/** One target in the sequence: a card showing its name (an `EditableName`, placeholder "Target"
 *  while it's the only one or "Target N" once there's more than one - see `count`) and DEF/ARM/
 *  Boxes inline; a gear button opens `TargetProfileDialog` for THIS target's own capabilities
 *  (Focus/Fury/Tough/etc.). Mirrors `AttackerCard`'s own card pattern. */
@Component({
  selector: 'app-target-panel',
  standalone: true,
  imports: [EditableName, EffectTags, MiniFieldSelect],
  templateUrl: './target-panel.html',
  // Shared partials first, this component's own file last - see attacker-card.ts for why.
  styleUrls: ['../shared/icon-btn.css', './target-panel.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TargetPanel {
  readonly target = input.required<Target>();
  readonly index = input.required<number>();
  /** Total target count - decides whether the name placeholder needs a number at all (see the
   *  component doc comment). */
  readonly count = input(1);
  readonly removable = input(true);

  readonly openProfile = output<void>();
  readonly remove = output<void>();

  protected readonly defOptions = DEF_OPTIONS;
  protected readonly armOptions = ARM_OPTIONS;
  protected readonly boxesOptions = BOXES_OPTIONS;
  protected readonly targetSummary = targetSummary;

  protected readonly toNumber = toNumber;
  /** DEF additionally accepts the 'KD' sentinel, which must not be converted to a number. */
  protected readonly parseDef = (raw: string): number | 'KD' => (raw === 'KD' ? 'KD' : Number(raw));
}
