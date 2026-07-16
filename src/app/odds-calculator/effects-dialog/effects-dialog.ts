import { ChangeDetectionStrategy, Component, ElementRef, ViewChild, signal } from '@angular/core';
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
import { toNumber } from '../select.util';
import { ToggleButton } from '../toggle-button/toggle-button';

@Component({
  selector: 'app-effects-dialog',
  standalone: true,
  imports: [FormsModule, ToggleButton],
  templateUrl: './effects-dialog.html',
  // Entirely shared styling - see target-panel.ts for why shared files load first (moot here
  // since this component has no CSS of its own, but kept for consistency with the other dialogs).
  styleUrls: ['../shared/dialog.css', '../shared/icon-btn.css', '../shared/dialog-sections.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EffectsDialog {
  @ViewChild('dialog') private dialogRef?: ElementRef<HTMLDialogElement>;

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
    this.dialogRef?.nativeElement.showModal();
  }

  close(): void {
    this.dialogRef?.nativeElement.close();
  }

  protected resetEffects(row: AttackRow): void {
    resetEffects(row);
  }

  /** 'armPenalty' is always present in `triggerEffects` (fixed key set), so this is never undefined. */
  protected armPenaltyEffect(row: AttackRow): TriggerEffectRow {
    return row.triggerEffects.find((e) => e.key === 'armPenalty')!;
  }

  /** Native <dialog> reports a click anywhere in the viewport while open; only the ::backdrop click has the dialog itself as target. */
  protected closeOnBackdropClick(event: MouseEvent, dialog: HTMLDialogElement): void {
    if (event.target === dialog) {
      dialog.close();
    }
  }
}
