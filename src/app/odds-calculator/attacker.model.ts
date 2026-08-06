import { WritableSignal, signal } from '@angular/core';
import { AttackType } from '../engine/attack-model';
import { AttackRow, cloneAttackRow, createAttackRow } from './attack-row.model';
import { range } from './range.util';

let nextAttackerId = 0;

/** 0-10, matching the tabletop's own realistic Focus/Fury stat range - see `constants.ts`'s
 *  `MAX_RESOURCE_POINTS` on the engine side, which this stays consistent with (unlike the target
 *  profile's own Focus/Fury dropdown, which goes up to 14 for a target's higher realistic ceiling). */
export const ATTACKER_FOCUS_OPTIONS = range(0, 10);

/**
 * One attacker in the sequence, owning the MAT/RAT/AAT its own attacks share (a model with a
 * melee weapon, a ranged weapon, and a spell all roll against the SAME three printed stats,
 * rather than each attack carrying its own copy) plus the list of attacks it makes, in order.
 */
export interface Attacker {
  readonly id: string;
  /** '' means unnamed - see `attackerDisplayName`. */
  readonly name: WritableSignal<string>;
  readonly mat: WritableSignal<number>;
  readonly rat: WritableSignal<number>;
  readonly aat: WritableSignal<number>;
  readonly attacks: WritableSignal<AttackRow[]>;
  /** Grants this attacker a single reroll, shared across every roll it makes (across every attack
   *  it owns) - spent on the first missed attack roll, or a below-average damage roll once nothing
   *  is left to miss, see `sequence.ts`'s Puppet Master section for the exact fixed rule. Edited via
   *  the attacker's "special rules" pop-up, not inline on the card. */
  readonly puppetMaster: WritableSignal<boolean>;
  /** Focus points (0-10) this attacker can spend, once per computation across the WHOLE sequence
   *  (every target, not reset per target - the attacker's own resource, not the target's): boost
   *  an attack or damage roll (+1 die, once per roll), or buy an extra melee attack fired after
   *  every one of this attacker's own configured attacks - spent optimally via full lookahead,
   *  exactly like the target's own Focus/Fury. Edited via the attacker's "special rules" pop-up,
   *  same as Puppet Master. See `sequence.ts`'s Attacker Focus section for the exact policy. */
  readonly focusPoints: WritableSignal<number>;
}

/** Short "label" summary tag for an active attacker-level special rule, shown under the attacker
 *  card - the attacker-level equivalent of `EffectSummaryTag`/`effectsSummary` for an attack row. */
export interface AttackerRuleSummaryTag {
  readonly key: 'puppetMaster' | 'focusPoints';
  readonly label: string;
}

/** Currently Puppet Master and Focus - more attacker-level toggles land here as they're added, the
 *  same way `effectsSummary` grows with new attack effects. */
export function attackerRulesSummary(attacker: Attacker): AttackerRuleSummaryTag[] {
  const tags: AttackerRuleSummaryTag[] = [];
  if (attacker.puppetMaster()) {
    tags.push({ key: 'puppetMaster', label: 'Puppet Master' });
  }
  if (attacker.focusPoints() > 0) {
    tags.push({ key: 'focusPoints', label: `Focus: ${attacker.focusPoints()}` });
  }
  return tags;
}

export function createAttacker(): Attacker {
  return {
    id: `attacker-${nextAttackerId++}`,
    name: signal(''),
    mat: signal(6),
    rat: signal(6),
    aat: signal(6),
    attacks: signal([createAttackRow()]),
    puppetMaster: signal(false),
    focusPoints: signal(0),
  };
}

/** Falls back to "Attacker N" (by current position) until the attacker is explicitly renamed -
 *  matches how an attack row's own number is always its live position, never a stored value. */
export function attackerDisplayName(attacker: Attacker, index: number): string {
  return attacker.name().trim() || `Attacker ${index + 1}`;
}

/** The stat THIS attacker brings to a given attack type - MAT for melee, RAT for ranged, AAT for
 *  arcane. The one piece of logic that actually implements "MAT/RAT/AAT live on the attacker,
 *  not the attack" - everything else here is just data plus copy-the-previous-attack add/remove. */
export function statFor(attacker: Attacker, type: AttackType): number {
  return type === 'melee' ? attacker.mat() : type === 'ranged' ? attacker.rat() : attacker.aat();
}

/** Copies the previous attack by default, same reasoning as the sequence-level add used to have
 *  before attacks were grouped by attacker - and the reason there's no separate per-attack
 *  "clone" action: this already does the same thing, one click away. */
export function addAttackTo(attacker: Attacker): void {
  attacker.attacks.update((rows) => {
    const last = rows.at(-1);
    return [...rows, last ? cloneAttackRow(last) : createAttackRow()];
  });
}

/** An attacker always keeps at least one attack - removing the last one is a no-op here; the UI
 *  disables that trash button instead (the whole attacker must be removed via its own button). */
export function removeAttackFrom(attacker: Attacker, rowId: string): void {
  attacker.attacks.update((rows) => (rows.length > 1 ? rows.filter((r) => r.id !== rowId) : rows));
}
