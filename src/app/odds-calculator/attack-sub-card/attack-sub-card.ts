import { CdkDragHandle } from '@angular/cdk/drag-drop';
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AttackType } from '../../engine/attack-model';
import {
  ATTACK_COUNT_OPTIONS,
  AttackRow,
  DICE_OPTIONS,
  POW_OPTIONS,
  RANGED_ATTACK_COUNT_OPTIONS,
  ROF_OPTIONS,
  TYPE_EMOJI,
  effectsSummary,
  parsePow,
  rangeSummary,
} from '../attack-row.model';
import { EffectTags } from '../effect-tags/effect-tags';
import { MiniFieldSelect } from '../mini-field-select/mini-field-select';
import { toNumber } from '../select.util';
import { Target } from '../target-panel/target-panel.model';

/** One attack within an `AttackerCard`: Type/ROF/POW/dice are edited directly here (moved back
 *  out of the attack-edit pop-up, which is effects-only again - see `AttackEditDialog`), so this
 *  is effectively the old flat attack row's own field set, minus MAT/RAT/AAT (which live on the
 *  parent `Attacker` now). */
@Component({
  selector: 'app-attack-sub-card',
  standalone: true,
  imports: [CdkDragHandle, EffectTags, FormsModule, MiniFieldSelect],
  templateUrl: './attack-sub-card.html',
  styleUrls: ['../shared/mini-field.css', '../shared/icon-btn.css', './attack-sub-card.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AttackSubCard {
  readonly row = input.required<AttackRow>();
  readonly removable = input(true);
  /** The live target list - only used to render `rangeSummary`'s own tags (below) once there's
   *  more than one target. */
  readonly targets = input<Target[]>([]);

  readonly edit = output<void>();
  readonly remove = output<void>();

  protected readonly attackTypes: AttackType[] = ['melee', 'ranged', 'arcane'];
  protected readonly attackCountOptions = ATTACK_COUNT_OPTIONS;
  protected readonly rangedAttackCountOptions = RANGED_ATTACK_COUNT_OPTIONS;
  protected readonly diceOptions = DICE_OPTIONS;
  protected readonly powOptions = POW_OPTIONS;
  protected readonly rofOptions = ROF_OPTIONS;

  protected readonly toNumber = toNumber;
  protected readonly parsePow = parsePow;

  /** Just the emoji - no text label - per the Type select's own display requirement. */
  protected readonly typeOptionLabel = (type: AttackType): string => TYPE_EMOJI[type];

  protected readonly effectsSummary = effectsSummary;
  protected readonly rangeSummary = rangeSummary;

  /** "Target 1, Target 2" - `rangeSummary`'s own tag list joined into the single "In range of: ..."
   *  line the template shows (see `attack-sub-card.html`). */
  protected rangeLabel(tags: { label: string }[]): string {
    return tags.map((t) => t.label).join(', ');
  }

  /** Only `attackCount` can end up out of range on a Type change: `RANGED_ATTACK_COUNT_OPTIONS`
   *  allows 0 (a pure-ROF weapon), but melee/arcane's own `ATTACK_COUNT_OPTIONS` starts at 1 - so
   *  switching away from Ranged with 0 selected needs bumping back to a valid value. `rof` itself
   *  never needs this: every `RofValue` is valid regardless of type (see its own doc comment). */
  protected onTypeChange(row: AttackRow, type: AttackType): void {
    if (type !== 'ranged' && row.attackCount() === 0) row.attackCount.set(1);
  }
}
