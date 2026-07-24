import { ChangeDetectionStrategy, Component, ViewChild, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  KOTD_OPTIONS,
  RESOURCE_OPTIONS,
  SCAPEGOAT_OPTIONS,
  SHIELD_AMOUNT_OPTIONS,
  SHIELD_GUARD_OPTIONS,
  SPELL_BONUS_OPTIONS,
  SPELL_RULE_LABELS,
  SPELL_RULE_OPTIONS,
  TargetState,
  ToughKind,
  createDispellableEffectRow,
  createStatSpellRow,
  resetTargetProfile,
} from '../target-panel/target-panel.model';
import { DialogShell } from '../dialog-shell/dialog-shell';
import { EditableName } from '../editable-name/editable-name';
import { toNumber } from '../select.util';
import { ToggleSelect } from '../toggle-select/toggle-select';

@Component({
  selector: 'app-target-profile-dialog',
  standalone: true,
  imports: [FormsModule, DialogShell, EditableName, ToggleSelect],
  templateUrl: './target-profile-dialog.html',
  // Shared partials first, this component's own file last - see target-panel.ts for why.
  styleUrls: ['../shared/icon-btn.css', '../shared/dialog-sections.css', './target-profile-dialog.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TargetProfileDialog {
  readonly target = input.required<TargetState>();

  protected readonly resourceOptions = RESOURCE_OPTIONS;
  protected readonly kotdOptions = KOTD_OPTIONS;
  protected readonly shieldGuardOptions = SHIELD_GUARD_OPTIONS;
  protected readonly scapegoatOptions = SCAPEGOAT_OPTIONS;
  protected readonly shieldAmountOptions = SHIELD_AMOUNT_OPTIONS;
  protected readonly spellBonusOptions = SPELL_BONUS_OPTIONS;
  protected readonly spellRuleOptions = SPELL_RULE_OPTIONS;
  protected readonly spellRuleLabels = SPELL_RULE_LABELS;
  protected readonly toNumber = toNumber;
  /** Shield's `ToggleSelect` formats its ARM bonus as "+N" rather than the plain "N" every other
   *  counter here uses. */
  protected readonly formatArmBonus = (v: number) => `+${v}`;

  @ViewChild('shell') private shell?: DialogShell;

  open(): void {
    this.shell?.open();
  }

  protected resetProfile(target: TargetState): void {
    resetTargetProfile(target);
  }

  /** A model only ever has Focus or Fury, never both - picking a nonzero value on one clears
   *  the other, enforced here rather than inside `ToggleSelect` (which stays domain-agnostic). */
  protected onFocusChange(target: TargetState, value: number): void {
    if (value > 0) target.furyPoints.set(0);
  }

  protected onFuryChange(target: TargetState, value: number): void {
    if (value > 0) target.focusPoints.set(0);
  }

  /** Toggling the already-active kind turns Toughness off; toggling the other one switches to it - mirrors
   *  `ToggleButton`'s own `toggle()`, since Tough/Tough Steady are just as mutually exclusive. */
  protected toggleToughKind(target: TargetState, kind: ToughKind): void {
    target.toughKind.set(target.toughKind() === kind ? 'off' : kind);
  }

  protected addStatSpell(target: TargetState): void {
    target.spellBonuses.update((list) => [...list, createStatSpellRow()]);
  }

  protected addDispellableEffect(target: TargetState): void {
    target.spellBonuses.update((list) => [...list, createDispellableEffectRow()]);
  }

  protected removeSpellBonus(target: TargetState, id: string): void {
    target.spellBonuses.update((list) => list.filter((s) => s.id !== id));
  }
}
