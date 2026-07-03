import { describe, expect, it } from 'vitest';
import { probabilityAtLeast, probabilityOfDouble, rollDicePool } from './dice-pool';
import { computeAttackOdds } from './attack-model';

describe('dice-pool', () => {
  it('2d6 distribution sums to 1 and matches the classic triangle', () => {
    const twoD6 = rollDicePool({ diceCount: 2 });
    const total = twoD6.reduce((a, o) => a + o.probability, 0);
    expect(total).toBeCloseTo(1, 9);

    const p = (sum: number) =>
      twoD6.filter((o) => o.sum === sum).reduce((a, o) => a + o.probability, 0);
    expect(p(7)).toBeCloseTo(6 / 36, 9);
    expect(p(2)).toBeCloseTo(1 / 36, 9);
    expect(p(12)).toBeCloseTo(1 / 36, 9);
  });

  it('P(2d6 >= 7) matches the standard 21/36 "need 7+" case', () => {
    const twoD6 = rollDicePool({ diceCount: 2 });
    expect(probabilityAtLeast(twoD6, 7)).toBeCloseTo(21 / 36, 9);
  });

  it('P(double on 2d6) = 1/6', () => {
    const twoD6 = rollDicePool({ diceCount: 2 });
    expect(probabilityOfDouble(twoD6)).toBeCloseTo(1 / 6, 9);
  });

  it('boosting (3d6 vs 2d6) strictly improves the chance to clear a threshold', () => {
    const twoD6 = rollDicePool({ diceCount: 2 });
    const threeD6 = rollDicePool({ diceCount: 3 });
    expect(probabilityAtLeast(threeD6, 7)).toBeGreaterThan(probabilityAtLeast(twoD6, 7));
  });

  it('discarding the highest of 3 dice lowers the expected value vs a plain 2d6 roll', () => {
    const twoD6 = rollDicePool({ diceCount: 2 });
    const discardHighest = rollDicePool({ diceCount: 3, discard: { count: 1, mode: 'highest' } });
    const total = discardHighest.reduce((a, o) => a + o.probability, 0);
    expect(total).toBeCloseTo(1, 9);

    const ev = (dist: typeof twoD6) => dist.reduce((a, o) => a + o.sum * o.probability, 0);
    expect(ev(discardHighest)).toBeLessThan(ev(twoD6));
  });
});

describe('attack-model', () => {
  it('matches a hand-computed case: MAT 6 vs DEF 13, POW 12 vs ARM 15', () => {
    // Hit needs dice sum >= def - stat = 7  =>  21/36
    // Damage dealt = max(0, 2d6 + 12 - 15) = max(0, 2d6 - 3); this is 0 when 2d6 <= 3 (sums 2,3) => 3/36
    const odds = computeAttackOdds({
      attack: { stat: 6 },
      damage: { pow: 12 },
      target: { def: 13, arm: 15, boxesRemaining: 1 },
    });

    expect(odds.hitChance).toBeCloseTo(21 / 36, 9);

    const zeroDamageGivenHit = 3 / 36;
    const expectedDamageZero = (1 - 21 / 36) + (21 / 36) * zeroDamageGivenHit;
    const dmgZero = odds.damageDistribution.find((d) => d.damage === 0)!.probability;
    expect(dmgZero).toBeCloseTo(expectedDamageZero, 9);

    const expectedDestroy = 21 / 36 - (21 / 36) * zeroDamageGivenHit;
    expect(odds.destroyChance).toBeCloseTo(expectedDestroy, 9);
  });

  it('Tough scales the destroy chance by the fail-roll probability', () => {
    const base = computeAttackOdds({
      attack: { stat: 6 },
      damage: { pow: 12 },
      target: { def: 13, arm: 15, boxesRemaining: 1 },
    });
    const tough = computeAttackOdds({
      attack: { stat: 6 },
      damage: { pow: 12 },
      target: { def: 13, arm: 15, boxesRemaining: 1, tough: true, toughOn: 5 },
    });
    // Tough on 5+ survives 2/6 of the time => fails (and is destroyed) 4/6 of the time.
    expect(tough.destroyChance).toBeCloseTo(base.destroyChance * (4 / 6), 9);
  });

  it('an auto-hit target (Knocked Down / Stationary) always hits', () => {
    const odds = computeAttackOdds({
      attack: { stat: 6, autoHit: true },
      damage: { pow: 10 },
      target: { def: 20, arm: 10, boxesRemaining: 1 },
    });
    expect(odds.hitChance).toBe(1);
  });
});
