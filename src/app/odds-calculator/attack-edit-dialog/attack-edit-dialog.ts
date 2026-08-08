import { ChangeDetectionStrategy, Component, ViewChild, input, signal } from '@angular/core';
import {
  ARM_PENALTY_OPTIONS,
  ATTACK_EFFECT_KEYS,
  AttackRow,
  CRIT_ONLY_SIMPLE_KEYS,
  DAMAGE_EFFECT_KEYS,
  GENERAL_EFFECT_KEYS,
  HIT_CRIT_PAIR_KEYS,
  RELOAD_OPTIONS,
  effectsFor,
  resetEffects,
} from '../attack-row.model';
import { DialogShell } from '../dialog-shell/dialog-shell';
import { Target, targetDisplayName } from '../target-panel/target-panel.model';
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

  /** The live target list - only used to render the "Targets" section (below), which itself is
   *  only shown once there's more than one (see the module doc comment's "Multiple targets"
   *  section for why a single-target sequence never needs this). */
  readonly targets = input<Target[]>([]);

  protected readonly armPenaltyOptions = ARM_PENALTY_OPTIONS;
  protected readonly generalEffectKeys = GENERAL_EFFECT_KEYS;
  protected readonly attackEffectKeys = ATTACK_EFFECT_KEYS;
  protected readonly damageEffectKeys = DAMAGE_EFFECT_KEYS;
  protected readonly hitCritPairKeys = HIT_CRIT_PAIR_KEYS;
  protected readonly critOnlySimpleKeys = CRIT_ONLY_SIMPLE_KEYS;
  protected readonly reloadOptions = RELOAD_OPTIONS;
  protected readonly effectsFor = effectsFor;
  protected readonly targetDisplayName = targetDisplayName;

  /** The `-X ARM` `ToggleSelect`s show "-2 ARM" (value first, ignoring the pill's own off-state
   *  label) once active - `formatPenalty` supplies the "-N" half, `formatPenaltyActive` the
   *  value-first "N ARM" wording (the off-state label "-X ARM" isn't a real noun like "Shield" or
   *  "DEF", so it's dropped once a concrete value is picked, unlike every other `ToggleSelect`'s
   *  `formatActive`). */
  protected readonly formatPenalty = (v: number) => `-${v}`;
  protected readonly formatPenaltyActive = (_label: string, v: string) => `${v} ARM`;

  /** Renders `Infinity` (unlimited Reload, exactly like a melee weapon's own unrestricted buying)
   *  as '∞' - every other value is just its plain number. */
  protected readonly formatReload = (v: number) => (v === Infinity ? '∞' : `${v}`);

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

  /** `null` means "every target" (the default) - see `AttackRow.eligibleTargetIds`'s own doc
   *  comment. */
  protected isTargetEligible(row: AttackRow, targetId: string): boolean {
    const ids = row.eligibleTargetIds();
    return ids === null || ids.includes(targetId);
  }

  /** An attack must stay in range of at least one target - this is the one target left standing
   *  once every other one has been toggled off, so its own button is disabled (see the template)
   *  to keep it that way: nothing left to fall back on if this one also came off. */
  protected isOnlyEligibleTarget(row: AttackRow, targetId: string): boolean {
    const current = row.eligibleTargetIds() ?? this.targets().map((t) => t.id);
    return current.length === 1 && current.includes(targetId);
  }

  /** Toggling a target while every target is currently eligible (`null`) starts from the full
   *  current target list rather than an empty one, so the click reads as "turn OFF just this one"
   *  (matching what the button visually showed as already active) instead of "turn on just this one".
   *  Turning off the LAST remaining eligible target is a no-op - see `isOnlyEligibleTarget`, which
   *  also disables the button so this path is defense-in-depth, not the only guard. */
  protected toggleTarget(row: AttackRow, targetId: string): void {
    const current = row.eligibleTargetIds() ?? this.targets().map((t) => t.id);
    if (current.includes(targetId) && current.length <= 1) return;
    row.eligibleTargetIds.set(current.includes(targetId) ? current.filter((id) => id !== targetId) : [...current, targetId]);
  }
}
