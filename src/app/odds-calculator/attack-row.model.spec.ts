import { describe, expect, it } from 'vitest';
import { createAttackRow, toSequencedAttack } from './attack-row.model';

describe('toSequencedAttack - Charge / Cavalry Charge', () => {
  it("'charge' marks the row eligible for a damage-only boost, but doesn't bake it into the base row", () => {
    const row = createAttackRow();
    const seq = toSequencedAttack(row, 0, 6, 'A', 0, false, 0, [], 'charge', true);
    expect(seq.chargeDamageBoost).toBe(true);
    expect(seq.chargeAttackBoost).toBeUndefined();
    expect(seq.boostedAttack).toBeUndefined();
    expect(seq.boostedDamage).toBeUndefined();
    expect(seq.damageModifiers?.boostDice).toBe(0);
    expect(seq.modifiers?.boostDice).toBe(0);
  });

  it("'cavalryCharge' marks the row eligible for both an attack and a damage boost, but doesn't bake either into the base row", () => {
    const row = createAttackRow();
    const seq = toSequencedAttack(row, 0, 6, 'A', 0, false, 0, [], 'cavalryCharge', true);
    expect(seq.chargeAttackBoost).toBe(true);
    expect(seq.chargeDamageBoost).toBe(true);
    expect(seq.boostedAttack).toBeUndefined();
    expect(seq.boostedDamage).toBeUndefined();
    expect(seq.modifiers?.boostDice).toBe(0);
    expect(seq.damageModifiers?.boostDice).toBe(0);
  });

  it('neither applies when this is not the first melee row', () => {
    const row = createAttackRow();
    const seq = toSequencedAttack(row, 0, 6, 'A', 0, false, 0, [], 'cavalryCharge', false);
    expect(seq.chargeAttackBoost).toBeUndefined();
    expect(seq.chargeDamageBoost).toBeUndefined();
    expect(seq.modifiers?.boostDice).toBe(0);
    expect(seq.damageModifiers?.boostDice).toBe(0);
  });

  it("'off' is a no-op even on the first melee row", () => {
    const row = createAttackRow();
    const seq = toSequencedAttack(row, 0, 6, 'A', 0, false, 0, [], 'off', true);
    expect(seq.chargeAttackBoost).toBeUndefined();
    expect(seq.chargeDamageBoost).toBeUndefined();
  });

  it("the weapon's own Boosted toggle is unaffected by charge eligibility - still reported independently", () => {
    const row = createAttackRow();
    row.triggerEffects.find((e) => e.key === 'boostedDamage')!.trigger.set('hit');
    const seq = toSequencedAttack(row, 0, 6, 'A', 0, false, 0, [], 'charge', true);
    expect(seq.boostedDamage).toBe(true);
    expect(seq.damageModifiers?.boostDice).toBe(1);
    expect(seq.chargeDamageBoost).toBe(true);
  });
});
