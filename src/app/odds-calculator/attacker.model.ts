import { WritableSignal, signal } from '@angular/core';
import { AttackType } from '../engine/attack-model';
import { AttackRow, cloneAttackRow, createAttackRow } from './attack-row.model';

let nextAttackerId = 0;

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
}

export function createAttacker(): Attacker {
  return {
    id: `attacker-${nextAttackerId++}`,
    name: signal(''),
    mat: signal(6),
    rat: signal(6),
    aat: signal(6),
    attacks: signal([createAttackRow()]),
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
