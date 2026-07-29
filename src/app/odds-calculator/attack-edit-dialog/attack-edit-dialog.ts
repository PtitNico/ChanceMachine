import { ChangeDetectionStrategy, Component, ViewChild, signal } from '@angular/core';
import {
  ARM_PENALTY_OPTIONS,
  ATTACK_EFFECT_KEYS,
  AttackRow,
  CRIT_ONLY_SIMPLE_KEYS,
  DAMAGE_EFFECT_KEYS,
  GENERAL_EFFECT_KEYS,
  HIT_CRIT_PAIR_KEYS,
  effectsFor,
  resetEffects,
} from '../attack-row.model';
import { DialogShell } from '../dialog-shell/dialog-shell';
import { ToggleButton } from '../toggle-button/toggle-button';
import { ToggleSelect } from '../toggle-select/toggle-select';

/**
 * Effects editor for a single attack - Type/ROF/Dice/POW/Dice are edited directly on the
 * `AttackSubCard` now (moved back out of here, see that component), so this pop-up is purely the
 * toggle-button sections that used to be the standalone `EffectsDialog`, before attacks were
 * grouped by attacker.
 */
@Component({
  selector: 'app-attack-edit-dialog',
  standalone: true,
  imports: [ToggleButton, ToggleSelect, DialogShell],
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

  /** The `-X ARM` `ToggleSelect`s show "-2 ARM" (value first, ignoring the pill's own off-state
   *  label) once active - `formatPenalty` supplies the "-N" half, `formatPenaltyActive` the
   *  value-first "N ARM" wording (the off-state label "-X ARM" isn't a real noun like "Shield" or
   *  "DEF", so it's dropped once a concrete value is picked, unlike every other `ToggleSelect`'s
   *  `formatActive`). */
  protected readonly formatPenalty = (v: number) => `-${v}`;
  protected readonly formatPenaltyActive = (_label: string, v: string) => `${v} ARM`;

  open(row: AttackRow): void {
    this.row.set(row);
    this.shell?.open();
  }

  protected resetEffects(row: AttackRow): void {
    resetEffects(row);
  }

  /** A single "-X ARM" instance triggers on a hit or a crit, never both - picking a nonzero value
   *  on one clears the other, same pattern as `TargetProfileDialog`'s `onFocusChange`/`onFuryChange`. */
  protected onArmPenaltyHitChange(row: AttackRow, value: number): void {
    if (value > 0) row.armPenaltyCritAmount.set(0);
  }

  protected onArmPenaltyCritChange(row: AttackRow, value: number): void {
    if (value > 0) row.armPenaltyHitAmount.set(0);
  }
}
