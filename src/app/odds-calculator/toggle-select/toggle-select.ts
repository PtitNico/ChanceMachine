import { ChangeDetectionStrategy, Component, WritableSignal, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { toNumber } from '../select.util';

/**
 * A pill-shaped `.toggle-btn` look-alike backed by a real `<select>` - looks like every other
 * boolean toggle in this dialog (plain label when its value is 0, "Label: N" and the active/brass
 * look once it isn't), but opens the native value picker on click/tap instead of just flipping a
 * boolean. The visible pill is a purely decorative `<span>`; the actual `<select>` is fully
 * invisible and absolutely positioned over it (see toggle-select.css) so its own `<option>` text
 * can just be the plain value - the native popup never shows "Label: N" per row, and never
 * inherits the pill's brass active color, since the select itself never carries that styling.
 * Follows `MiniFieldSelect`'s "bind directly to the `WritableSignal`" convention. `valueChange` is
 * optional - only Focus/Fury's own mutual-exclusivity handling needs it (see
 * `TargetProfileDialog`); every other use just binds `[signal]`/`[options]` and nothing else.
 * `formatValue` controls how a value renders in both the native `<option>` list and the active
 * pill - defaults to the plain number, overridden by Shield/Custom effects to show "+N". `formatActive`
 * controls how the active pill combines the label with that formatted value - defaults to
 * "Label: N" (Shield's "Shield: +N"), overridden by Custom effects' DEF/ARM controls to "+N Label"
 * ("+2 ARM") instead.
 */
@Component({
  selector: 'app-toggle-select',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './toggle-select.html',
  styleUrls: ['../shared/dialog-sections.css', './toggle-select.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToggleSelect {
  readonly label = input.required<string>();
  readonly signal = input.required<WritableSignal<number>>();
  readonly options = input.required<readonly number[]>();
  readonly title = input('');
  readonly formatValue = input<(v: number) => string>((v) => `${v}`);
  readonly formatActive = input<(label: string, formattedValue: string) => string>((label, v) => `${label}: ${v}`);
  readonly valueChange = output<number>();

  protected onChange(raw: string): void {
    const value = toNumber(raw);
    this.signal().set(value);
    this.valueChange.emit(value);
  }
}
