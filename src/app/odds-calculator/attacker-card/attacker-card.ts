import { ChangeDetectionStrategy, Component, ElementRef, ViewChild, afterNextRender, computed, input, output } from '@angular/core';
import { AttackType } from '../../engine/attack-model';
import { AttackRow, STAT_OPTIONS } from '../attack-row.model';
import { AttackSubCard } from '../attack-sub-card/attack-sub-card';
import { Attacker } from '../attacker.model';
import { MiniFieldSelect } from '../mini-field-select/mini-field-select';
import { toNumber } from '../select.util';

/** One attacker in the sequence: a card showing its name (a `contenteditable` span - click/tap
 *  the text directly to rename, no separate input/button pair) and MAT/RAT/AAT, holding its own
 *  attacks as `AttackSubCard`s. There's deliberately no general "edit attacker" pop-up anymore:
 *  name and stats are everything an attacker has today, and both are already inline - one will
 *  come back once there's an attacker-level thing that genuinely needs it (Puppet Master, etc.). */
@Component({
  selector: 'app-attacker-card',
  standalone: true,
  imports: [AttackSubCard, MiniFieldSelect],
  templateUrl: './attacker-card.html',
  styleUrls: ['../shared/icon-btn.css', './attacker-card.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AttackerCard {
  readonly attacker = input.required<Attacker>();
  readonly index = input.required<number>();
  readonly removable = input(true);

  readonly addAttack = output<void>();
  readonly remove = output<void>();
  /** Bubbled up from an `AttackSubCard` unchanged - the attack-edit pop-up only needs the row
   *  itself, not which attacker it belongs to (MAT/RAT/AAT are edited separately). */
  readonly editAttack = output<AttackRow>();
  readonly removeAttack = output<string>();

  protected readonly statOptions = STAT_OPTIONS;
  protected readonly toNumber = toNumber;

  /** MAT/RAT/AAT are only worth showing (and editing) when this attacker actually has an attack
   *  of that type - a melee-only attacker has no use for RAT or AAT. Reads every attack's own
   *  `type()` signal, so adding/removing/retyping an attack updates this immediately. */
  protected readonly presentTypes = computed<ReadonlySet<AttackType>>(
    () => new Set(this.attacker().attacks().map((row) => row.type()))
  );

  @ViewChild('nameSpan') private nameSpanRef?: ElementRef<HTMLSpanElement>;

  constructor() {
    /* The name span's content is set here, once, imperatively - NOT via a template interpolation
     * bound to the name signal. Angular's own text-interpolation tracks a specific DOM text node
     * it created; contenteditable typing can make the browser create its own separate text node
     * instead of reusing that one, and if the signal is later updated (on blur) Angular then
     * writes into ITS now-stale node too, leaving both in the DOM at once (visibly duplicating
     * the name). Setting textContent exactly once up front, and only ever afterwards on blur -
     * see onNameBlur - sidesteps that entirely: nothing about typing ever touches a live binding. */
    afterNextRender(() => {
      if (this.nameSpanRef) {
        this.nameSpanRef.nativeElement.textContent = this.attacker().name();
      }
    });
  }

  /** Commits the contenteditable span's final text back to the model - only on blur, never on
   *  every keystroke, so nothing ever re-renders the span's content while the user is typing. */
  protected onNameBlur(span: HTMLElement): void {
    const text = span.textContent?.trim() ?? '';
    if (!text) {
      span.textContent = '';
    }
    this.attacker().name.set(text);
  }
}
