import { describe, expect, it } from 'vitest';
import { createAttackRow, toSequencedAttack } from './attack-row.model';

describe('toSequencedAttack - Charge / Cavalry Charge', () => {
  it("'charge' boosts only the damage roll of the first melee row", () => {
    const row = createAttackRow();
    const seq = toSequencedAttack(row, 0, 6, 'A', 0, false, 0, [], 'charge', true);
    expect(seq.boostedDamage).toBe(true);
    expect(seq.boostedAttack).toBeUndefined();
    expect(seq.damageModifiers?.boostDice).toBe(1);
    expect(seq.modifiers?.boostDice).toBe(0);
  });

  it("'cavalryCharge' boosts both the attack and damage rolls of the first melee row", () => {
    const row = createAttackRow();
    const seq = toSequencedAttack(row, 0, 6, 'A', 0, false, 0, [], 'cavalryCharge', true);
    expect(seq.boostedAttack).toBe(true);
    expect(seq.boostedDamage).toBe(true);
    expect(seq.modifiers?.boostDice).toBe(1);
    expect(seq.damageModifiers?.boostDice).toBe(1);
  });

  it('neither applies when this is not the first melee row', () => {
    const row = createAttackRow();
    const seq = toSequencedAttack(row, 0, 6, 'A', 0, false, 0, [], 'cavalryCharge', false);
    expect(seq.boostedAttack).toBeUndefined();
    expect(seq.boostedDamage).toBeUndefined();
    expect(seq.modifiers?.boostDice).toBe(0);
    expect(seq.damageModifiers?.boostDice).toBe(0);
  });

  it("'off' is a no-op even on the first melee row", () => {
    const row = createAttackRow();
    const seq = toSequencedAttack(row, 0, 6, 'A', 0, false, 0, [], 'off', true);
    expect(seq.boostedAttack).toBeUndefined();
    expect(seq.boostedDamage).toBeUndefined();
  });

  it('is not cumulative with the weapon\'s own Boosted toggle - still just +1 die, not +2', () => {
    const row = createAttackRow();
    row.triggerEffects.find((e) => e.key === 'boostedDamage')!.trigger.set('hit');
    const seq = toSequencedAttack(row, 0, 6, 'A', 0, false, 0, [], 'charge', true);
    expect(seq.boostedDamage).toBe(true);
    expect(seq.damageModifiers?.boostDice).toBe(1);
  });

  it('cavalryCharge composes with an already-Boosted attack roll without stacking', () => {
    const row = createAttackRow();
    row.triggerEffects.find((e) => e.key === 'boostedAttack')!.trigger.set('hit');
    const seq = toSequencedAttack(row, 0, 6, 'A', 0, false, 0, [], 'cavalryCharge', true);
    expect(seq.boostedAttack).toBe(true);
    expect(seq.modifiers?.boostDice).toBe(1);
  });
});
