import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AttackType } from '../../engine/attack-model';
import {
  AttackRow,
  DICE_OPTIONS,
  POW_OPTIONS,
  STAT_LABELS,
  STAT_OPTIONS,
  effectsSummary,
  parsePow,
} from '../attack-row.model';
import { EffectTags } from '../effect-tags/effect-tags';
import { MiniFieldSelect } from '../mini-field-select/mini-field-select';
import { toNumber } from '../select.util';

@Component({
  selector: 'app-attack-row',
  standalone: true,
  imports: [FormsModule, EffectTags, MiniFieldSelect],
  templateUrl: './attack-row.html',
  // Shared partials first, this component's own file last - see target-panel.ts for why.
  styleUrls: ['../shared/scrollable-row.css', '../shared/icon-btn.css', './attack-row.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AttackRowComponent {
  readonly row = input.required<AttackRow>();
  readonly index = input.required<number>();
  readonly removable = input(true);

  readonly openEffects = output<void>();
  readonly remove = output<void>();

  protected readonly attackTypes: AttackType[] = ['melee', 'ranged', 'arcane'];
  protected readonly statOptions = STAT_OPTIONS;
  protected readonly diceOptions = DICE_OPTIONS;
  protected readonly powOptions = POW_OPTIONS;
  protected readonly effectsSummary = effectsSummary;
  protected readonly statLabel = (type: AttackType) => STAT_LABELS[type];

  protected readonly toNumber = toNumber;
  protected readonly parsePow = parsePow;
}
