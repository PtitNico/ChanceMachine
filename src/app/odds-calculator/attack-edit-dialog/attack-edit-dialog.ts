import { ChangeDetectionStrategy, Component, ViewChild, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  ARM_PENALTY_OPTIONS,
  ATTACK_EFFECT_KEYS,
  AttackRow,
  CRIT_ONLY_SIMPLE_KEYS,
  DAMAGE_EFFECT_KEYS,
  GENERAL_EFFECT_KEYS,
  HIT_CRIT_PAIR_KEYS,
  TriggerEffectRow,
  effectsFor,
  resetEffects,
} from '../attack-row.model';
import { DialogShell } from '../dialog-shell/dialog-shell';
import { toNumber } from '../select.util';
import { ToggleButton } from '../toggle-button/toggle-button';

/**
 * Effects editor for a single attack - Type/ROF/Dice/POW/Dice are edited directly on the
 * `AttackSubCard` now (moved back out of here, see that component), so this pop-up is purely the
 * toggle-button sections that used to be the standalone `EffectsDialog`, before attacks were
 * grouped by attacker.
 */
@Component({
  selector: 'app-attack-edit-dialog',
  standalone: true,
  imports: [FormsModule, ToggleButton, DialogShell],
  templateUrl: './attack-edit-dialog.html',
  styleUrls: ['../shared/dialog-sections.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AttackEditDialog {
  @ViewChild('shell') private shell?: DialogShell;

  /** The row currently being edited - set by `open()`, read directly by the template. */
  protected readonly row = signal<AttackRow | null>(null);

  protected readonly armPenaltyOptions = ARM_PENALTY_OPTIONS;
  protected readonly generalEffectKeys = GENERAL_EFFECT_KEYS;
  protected readonly attackEffectKeys = ATTACK_EFFECT_KEYS;
  protected readonly damageEffectKeys = DAMAGE_EFFECT_KEYS;
  protected readonly hitCritPairKeys = HIT_CRIT_PAIR_KEYS;
  protected readonly critOnlySimpleKeys = CRIT_ONLY_SIMPLE_KEYS;
  protected readonly effectsFor = effectsFor;

  protected readonly toNumber = toNumber;

  open(row: AttackRow): void {
    this.row.set(row);
    this.shell?.open();
  }

  protected resetEffects(row: AttackRow): void {
    resetEffects(row);
  }

  /** 'armPenalty' is always present in `triggerEffects` (fixed key set), so this is never undefined. */
  protected armPenaltyEffect(row: AttackRow): TriggerEffectRow {
    return row.triggerEffects.find((e) => e.key === 'armPenalty')!;
  }
}
