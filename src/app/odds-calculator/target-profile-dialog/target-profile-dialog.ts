import { ChangeDetectionStrategy, Component, ElementRef, ViewChild, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  RESOURCE_OPTIONS,
  SHIELD_AMOUNT_OPTIONS,
  SPELL_BONUS_OPTIONS,
  SPELL_RULE_LABELS,
  SPELL_RULE_OPTIONS,
  SpellBonusKind,
  SpellBonusRow,
  TargetState,
  ToughKind,
  createSpellBonusRow,
  resetTargetProfile,
} from '../target-panel/target-panel.model';
import { toNumber } from '../select.util';

@Component({
  selector: 'app-target-profile-dialog',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './target-profile-dialog.html',
  // Shared partials first, this component's own file last - see target-panel.ts for why.
  styleUrls: [
    '../shared/dialog.css',
    '../shared/icon-btn.css',
    '../shared/dialog-sections.css',
    './target-profile-dialog.css',
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TargetProfileDialog {
  readonly target = input.required<TargetState>();

  protected readonly resourceOptions = RESOURCE_OPTIONS;
  protected readonly shieldAmountOptions = SHIELD_AMOUNT_OPTIONS;
  protected readonly spellBonusOptions = SPELL_BONUS_OPTIONS;
  protected readonly spellRuleOptions = SPELL_RULE_OPTIONS;
  protected readonly spellRuleLabels = SPELL_RULE_LABELS;
  protected readonly toNumber = toNumber;

  @ViewChild('dialog') private dialogRef?: ElementRef<HTMLDialogElement>;

  open(): void {
    this.dialogRef?.nativeElement.showModal();
  }

  close(): void {
    this.dialogRef?.nativeElement.close();
  }

  protected resetProfile(target: TargetState): void {
    resetTargetProfile(target);
  }

  /** Toggling the already-active kind turns Toughness off; toggling the other one switches to it - mirrors
   *  EffectsDialog's `toggleTriggerEffect`, since Tough/Tough Steady are just as mutually exclusive. */
  protected toggleToughKind(target: TargetState, kind: ToughKind): void {
    target.toughKind.set(target.toughKind() === kind ? 'off' : kind);
  }

  protected addSpellBonus(target: TargetState): void {
    target.spellBonuses.update((list) => [...list, createSpellBonusRow()]);
  }

  /** A 'rule' spell is always dispellable - a permanent, non-dispellable rule belongs directly
   *  in "Special rules" instead (see `SpellBonusRow` doc comment), so switching to 'rule' forces
   *  it and the template disables the checkbox to keep that invariant visible. */
  protected setSpellKind(spell: SpellBonusRow, kind: SpellBonusKind): void {
    spell.kind.set(kind);
    if (kind === 'rule') {
      spell.dispellable.set(true);
    }
  }

  protected removeSpellBonus(target: TargetState, id: string): void {
    target.spellBonuses.update((list) => list.filter((s) => s.id !== id));
  }

  /** Native <dialog> reports a click anywhere in the viewport while open; only the ::backdrop click has the dialog itself as target. */
  protected closeOnBackdropClick(event: MouseEvent, dialog: HTMLDialogElement): void {
    if (event.target === dialog) {
      dialog.close();
    }
  }
}
