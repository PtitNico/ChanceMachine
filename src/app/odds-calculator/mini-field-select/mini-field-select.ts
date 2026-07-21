import { ChangeDetectionStrategy, Component, WritableSignal, input } from '@angular/core';
import { FormsModule } from '@angular/forms';

/**
 * One `.mini-field` labelled `<select>`, bound directly to a `WritableSignal<T>` - the repeated
 * shape behind DEF/ARM/Boxes (`TargetPanel`), MAT/RAT/AAT (`AttackerCard`), and
 * Type/ROF/Dice/POW/Dice (`AttackSubCard`): a label, a `<select>` looping over a fixed options
 * array, writing back through a string-to-`T` parser. `parse` defaults to a plain cast (`raw as
 * unknown as T`), which is all `AttackType`'s own select needs - a `<select>` change event is
 * already the right string value, nothing to actually convert; every numeric field passes
 * `toNumber`, `parseDef`, or `parsePow` explicitly instead, exactly as it did when each of these
 * was hand-written inline.
 */
@Component({
  selector: 'app-mini-field-select',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './mini-field-select.html',
  styleUrls: ['../shared/mini-field.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MiniFieldSelect<T> {
  readonly label = input.required<string>();
  readonly signal = input.required<WritableSignal<T>>();
  readonly options = input.required<readonly T[]>();
  readonly narrow = input(false);
  readonly parse = input<(raw: string) => T>((raw) => raw as unknown as T);
  /** How each `<option>` is displayed - defaults to the raw value's own string form (correct for
   *  every numeric/RofValue field). Type's own select overrides this to prefix the weapon-type
   *  emoji (🗡️/🏹/🪄). */
  readonly optionLabel = input<(v: T) => string>((v) => `${v}`);
}
