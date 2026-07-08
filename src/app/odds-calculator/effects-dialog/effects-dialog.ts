import { ChangeDetectionStrategy, Component, ElementRef, ViewChild, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { EffectTrigger } from '../../engine/attack-model';
import {
  ARM_PENALTY_OPTIONS,
  AttackRow,
  TRIGGER_EFFECT_LABELS,
  TriggerEffectKey,
  TriggerEffectRow,
  resetEffects,
} from '../attack-row.model';
import { toNumber } from '../select.util';

@Component({
  selector: 'app-effects-dialog',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './effects-dialog.html',
  // Shared partials first, this component's own file last - see target-panel.ts for why.
  styleUrls: ['../shared/dialog.css', '../shared/icon-btn.css', './effects-dialog.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EffectsDialog {
  @ViewChild('dialog') private dialogRef?: ElementRef<HTMLDialogElement>;

  /** The row currently being edited - set by `open()`, read directly by the template. */
  protected readonly row = signal<AttackRow | null>(null);

  protected readonly armPenaltyOptions = ARM_PENALTY_OPTIONS;
  protected readonly triggerEffectLabel = (key: TriggerEffectKey) => TRIGGER_EFFECT_LABELS[key];
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

  /** Toggling the already-active trigger for this effect turns it off; toggling the other one switches to it. */
  protected toggleTriggerEffect(effect: TriggerEffectRow, trigger: EffectTrigger): void {
    effect.trigger.set(effect.trigger() === trigger ? 'off' : trigger);
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
