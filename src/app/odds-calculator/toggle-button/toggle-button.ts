import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { EffectTrigger } from '../../engine/attack-model';
import { TRIGGER_EFFECT_LABELS, TriggerEffectRow } from '../attack-row.model';

/**
 * A single `.toggle-btn` bound to one `TriggerEffectRow` - replaces what used to be a hand-written
 * button block (label, active class, click handler) repeated once per effect across the Effects
 * dialog. Covers both toggle shapes the app needs:
 * - A plain on/off switch: the default `activeValue="hit"` is the only value a "simple" effect
 *   (no real hit/crit distinction) is ever set to, so the caller renders exactly ONE of these per
 *   effect.
 * - One half of a hit/crit PAIR: pass `activeValue="crit"` for the second button, rendered
 *   alongside a first one (`activeValue="hit"`, the default) bound to the SAME `TriggerEffectRow` -
 *   see that interface's own doc comment for why one shape covers both cases.
 *
 * Clicking the already-active value turns the effect off; clicking a DIFFERENT value switches to
 * it directly (relevant only for pair buttons - moves the effect from "on hit" to "on crit"
 * without needing to turn it off first).
 */
@Component({
  selector: 'app-toggle-button',
  standalone: true,
  templateUrl: './toggle-button.html',
  styleUrls: ['../shared/dialog-sections.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToggleButton {
  readonly effect = input.required<TriggerEffectRow>();
  readonly activeValue = input<EffectTrigger>('hit');

  protected readonly label = computed(() => TRIGGER_EFFECT_LABELS[this.effect().key]);
  protected readonly active = computed(() => this.effect().trigger() === this.activeValue());

  protected toggle(): void {
    const effect = this.effect();
    const value = this.activeValue();
    effect.trigger.set(effect.trigger() === value ? 'off' : value);
  }
}
