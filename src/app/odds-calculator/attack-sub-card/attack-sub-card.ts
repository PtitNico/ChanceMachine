import { CdkDragHandle } from '@angular/cdk/drag-drop';
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { AttackType } from '../../engine/attack-model';
import { AttackRow, DICE_OPTIONS, POW_OPTIONS, ROF_OPTIONS, TYPE_EMOJI, effectsSummary, parsePow } from '../attack-row.model';
import { EffectTags } from '../effect-tags/effect-tags';
import { MiniFieldSelect } from '../mini-field-select/mini-field-select';
import { toNumber } from '../select.util';

/** One attack within an `AttackerCard`: Type/ROF/POW/dice are edited directly here (moved back
 *  out of the attack-edit pop-up, which is effects-only again - see `AttackEditDialog`), so this
 *  is effectively the old flat attack row's own field set, minus MAT/RAT/AAT (which live on the
 *  parent `Attacker` now). */
@Component({
  selector: 'app-attack-sub-card',
  standalone: true,
  imports: [CdkDragHandle, EffectTags, MiniFieldSelect],
  templateUrl: './attack-sub-card.html',
  styleUrls: ['../shared/icon-btn.css', './attack-sub-card.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AttackSubCard {
  readonly row = input.required<AttackRow>();
  readonly removable = input(true);

  readonly edit = output<void>();
  readonly remove = output<void>();

  protected readonly attackTypes: AttackType[] = ['melee', 'ranged', 'arcane'];
  protected readonly diceOptions = DICE_OPTIONS;
  protected readonly powOptions = POW_OPTIONS;
  protected readonly rofOptions = ROF_OPTIONS;

  protected readonly toNumber = toNumber;
  protected readonly parsePow = parsePow;

  /** Just the emoji - no text label - per the Type select's own display requirement. */
  protected readonly typeOptionLabel = (type: AttackType): string => TYPE_EMOJI[type];

  protected readonly effectsSummary = effectsSummary;
}
