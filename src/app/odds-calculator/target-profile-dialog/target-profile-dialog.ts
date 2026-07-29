import { ChangeDetectionStrategy, Component, ViewChild, input } from '@angular/core';
import {
  KOTD_OPTIONS,
  RESOURCE_OPTIONS,
  SCAPEGOAT_OPTIONS,
  SHIELD_AMOUNT_OPTIONS,
  SHIELD_GUARD_OPTIONS,
  SPELL_BONUS_OPTIONS,
  TargetState,
  ToughKind,
  resetTargetProfile,
} from '../target-panel/target-panel.model';
import { DialogShell } from '../dialog-shell/dialog-shell';
import { ToggleSelect } from '../toggle-select/toggle-select';

@Component({
  selector: 'app-target-profile-dialog',
  standalone: true,
  imports: [DialogShell, ToggleSelect],
  templateUrl: './target-profile-dialog.html',
  styleUrls: ['../shared/dialog-sections.css'],
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
  /** Shield's and the two spell sections' DEF/ARM `ToggleSelect`s format their value as "+N" rather
   *  than the plain "N" every other counter here uses. */
  protected readonly formatBonus = (v: number) => `+${v}`;
  /** The two spell sections' DEF/ARM `ToggleSelect`s show "+N Label" ("+2 ARM") rather than the
   *  default "Label: N" every other counter here uses (Shield included). */
  protected readonly formatStatActive = (label: string, v: string) => `${v} ${label}`;

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
   *  `ToggleButton`'s own `toggle()`, since Tough/Tough Steady are just as mutually exclusive. Also
   *  mutually exclusive with the dispellable Tough grant below (a model is only ever Tough one way
   *  at a time) - clearing it whenever this ends up active. */
  protected toggleToughKind(target: TargetState, kind: ToughKind): void {
    target.toughKind.set(target.toughKind() === kind ? 'off' : kind);
    if (target.toughKind() !== 'off') target.dispellableTough.set(false);
  }

  /** Mutually exclusive with `toughKind`/`unyielding` above - a model is Tough (or Unyielding)
   *  either permanently or via a dispellable grant, never counted as both at once. */
  protected toggleDispellableTough(target: TargetState): void {
    const next = !target.dispellableTough();
    target.dispellableTough.set(next);
    if (next) target.toughKind.set('off');
  }

  protected toggleUnyielding(target: TargetState): void {
    const next = !target.unyielding();
    target.unyielding.set(next);
    if (next) target.dispellableUnyielding.set(false);
  }

  protected toggleDispellableUnyielding(target: TargetState): void {
    const next = !target.dispellableUnyielding();
    target.dispellableUnyielding.set(next);
    if (next) target.unyielding.set(false);
  }
}
