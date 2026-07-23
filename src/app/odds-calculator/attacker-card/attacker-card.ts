import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  ViewChild,
  afterNextRender,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { AttackType } from '../../engine/attack-model';
import { AttackRow, STAT_OPTIONS } from '../attack-row.model';
import { AttackSubCard } from '../attack-sub-card/attack-sub-card';
import { Attacker, attackerRulesSummary } from '../attacker.model';
import { EffectTags } from '../effect-tags/effect-tags';
import { MiniFieldSelect } from '../mini-field-select/mini-field-select';
import { toNumber } from '../select.util';

/** One attacker in the sequence: a card showing its name (a `contenteditable` span - click/tap
 *  the text directly to rename, no separate input/button pair) and MAT/RAT/AAT, holding its own
 *  attacks as `AttackSubCard`s. Name and stats stay inline (no pop-up needed for those); a gear
 *  button opens `AttackerRulesDialog` for attacker-level capabilities that DO need one (currently
 *  just Puppet Master). */
@Component({
  selector: 'app-attacker-card',
  standalone: true,
  imports: [CdkDropList, CdkDrag, CdkDragHandle, AttackSubCard, EffectTags, MiniFieldSelect],
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
  readonly openRules = output<void>();
  /** Bubbled up from an `AttackSubCard` unchanged - the attack-edit pop-up only needs the row
   *  itself, not which attacker it belongs to (MAT/RAT/AAT are edited separately). */
  readonly editAttack = output<AttackRow>();
  readonly removeAttack = output<string>();

  protected readonly statOptions = STAT_OPTIONS;
  protected readonly toNumber = toNumber;
  protected readonly attackerRulesSummary = attackerRulesSummary;

  /** MAT/RAT/AAT are only worth showing (and editing) when this attacker actually has an attack
   *  of that type - a melee-only attacker has no use for RAT or AAT. Reads every attack's own
   *  `type()` signal, so adding/removing/retyping an attack updates this immediately. */
  protected readonly presentTypes = computed<ReadonlySet<AttackType>>(
    () => new Set(this.attacker().attacks().map((row) => row.type()))
  );

  @ViewChild('nameSpan') private nameSpanRef?: ElementRef<HTMLSpanElement>;
  @ViewChild('addAttackBtn') private addAttackBtnRef?: ElementRef<HTMLButtonElement>;

  private readonly injector = inject(Injector);

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

  /** Reorders this attacker's own attacks by dragging an `AttackSubCard`'s handle - a separate
   *  drop list per attacker card, so dragging never moves an attack to a different attacker. */
  protected onAttackDrop(event: CdkDragDrop<AttackRow[]>): void {
    const reordered = [...this.attacker().attacks()];
    moveItemInArray(reordered, event.previousIndex, event.currentIndex);
    this.attacker().attacks.set(reordered);
  }

  /** Emits `addAttack` (the parent owns the actual mutation - see `attacker.model.ts`'s
   *  `addAttackTo`), then scrolls this button into view - it's the last element in the card, so
   *  bringing it into view also reveals as much of the freshly-appended row above it as fits. A
   *  card with several attacks already can otherwise push both off the bottom of `.attacker-list`'s
   *  own scroll area (see odds-calculator.css), leaving no visible feedback that the click worked. */
  protected onAddAttack(): void {
    this.addAttack.emit();
    afterNextRender(() => this.addAttackBtnRef?.nativeElement.scrollIntoView({ block: 'nearest' }), {
      injector: this.injector,
    });
  }
}
