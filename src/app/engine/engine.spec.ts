import { describe, expect, it } from 'vitest';
import { probabilityAtLeast, probabilityOfDouble, rerollPoolOnceIfBelow, rollDicePool } from './dice-pool';
import { computeAttackOdds } from './attack-model';
import { computeSequenceOdds, SequencedAttack } from './sequence';

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
    const discardHighest = rollDicePool({ diceCount: 3, discard: { highest: 1 } });
    const total = discardHighest.reduce((a, o) => a + o.probability, 0);
    expect(total).toBeCloseTo(1, 9);

    const ev = (dist: typeof twoD6) => dist.reduce((a, o) => a + o.sum * o.probability, 0);
    expect(ev(discardHighest)).toBeLessThan(ev(twoD6));
  });

  it('discarding both the highest and lowest of 4 dice narrows the sum distribution', () => {
    const fourD6 = rollDicePool({ diceCount: 4, discard: { highest: 1, lowest: 1 } });
    const total = fourD6.reduce((a, o) => a + o.probability, 0);
    expect(total).toBeCloseTo(1, 9);

    const twoD6 = rollDicePool({ diceCount: 2 });
    const p = (dist: typeof twoD6, sum: number) =>
      dist.filter((o) => o.sum === sum).reduce((a, o) => a + o.probability, 0);

    // Keeping the two middle-ranked dice out of four can still reach the extremes 2 and 12
    // (e.g. three dice showing 1), but far less often than a plain 2d6 roll - it now takes 3
    // matching extreme dice instead of just 2 to produce an extreme sum.
    expect(p(fourD6, 2)).toBeGreaterThan(0);
    expect(p(fourD6, 2)).toBeLessThan(p(twoD6, 2));
    expect(p(fourD6, 12)).toBeLessThan(p(twoD6, 12));

    const ev = (dist: typeof twoD6) => dist.reduce((a, o) => a + o.sum * o.probability, 0);
    expect(ev(fourD6)).toBeCloseTo(ev(twoD6), 6); // discarding symmetric extremes doesn't shift the mean (still 7)
  });

  it('reroll-if-below-threshold preserves probability mass and hasDouble correlation', () => {
    const twoD6 = rollDicePool({ diceCount: 2 });
    const rerolled = rerollPoolOnceIfBelow(twoD6, 7);

    const total = rerolled.reduce((a, o) => a + o.probability, 0);
    expect(total).toBeCloseTo(1, 9);

    // P(crit) after "reroll if sum < 7" = P(sum>=7 and double) + P(sum<7) * P(double)
    // (a kept roll keeps its own double status; a rerolled roll follows the full original distribution).
    const pDoubleAndAtLeast7 = twoD6
      .filter((o) => o.sum >= 7 && o.hasDouble)
      .reduce((a, o) => a + o.probability, 0);
    const pBelow7 = twoD6.filter((o) => o.sum < 7).reduce((a, o) => a + o.probability, 0);
    const pDouble = probabilityOfDouble(twoD6);
    const expectedCrit = pDoubleAndAtLeast7 + pBelow7 * pDouble;

    expect(probabilityOfDouble(rerolled)).toBeCloseTo(expectedCrit, 9);
    // A reroll can only ever help (or match) the chance of clearing the threshold it was for.
    expect(probabilityAtLeast(rerolled, 7)).toBeGreaterThanOrEqual(probabilityAtLeast(twoD6, 7));
  });

  it('"treat 1s as 6s" (Jump the Shark) removes the minimum roll and inflates the maximum', () => {
    const jts = rollDicePool({ diceCount: 2, treatOnesAsSixes: true });

    const total = jts.reduce((a, o) => a + o.probability, 0);
    expect(total).toBeCloseTo(1, 9);

    // Snake eyes (1,1) is impossible once every 1 becomes a 6.
    expect(jts.find((o) => o.sum === 2)).toBeUndefined();
    // Sum=12 is now reached by any combination of {1,6} on both dice (4 of the 36 tuples),
    // not just (6,6) - and it's still necessarily a double, since both transformed faces are 6.
    const twelve = jts.find((o) => o.sum === 12);
    expect(twelve?.probability).toBeCloseTo(4 / 36, 9);
    expect(twelve?.hasDouble).toBe(true);
  });

  it('extra crit-only dice (Sanguine Fate) raise crit chance without changing the sum distribution', () => {
    const plain = rollDicePool({ diceCount: 2 });
    const withExtra = rollDicePool({ diceCount: 2, extraCritDice: 1 });

    const total = withExtra.reduce((a, o) => a + o.probability, 0);
    expect(total).toBeCloseTo(1, 9);

    // The extra die never contributes to the sum, so the sum-only distribution is unaffected.
    expect(probabilityAtLeast(withExtra, 7)).toBeCloseTo(probabilityAtLeast(plain, 7), 9);
    // But it can still create a "double" with either of the two real dice, so crit chance goes up.
    expect(probabilityOfDouble(withExtra)).toBeGreaterThan(probabilityOfDouble(plain));
  });
});

describe('attack-model', () => {
  it('matches a hand-computed case: MAT 6 vs DEF 13, POW 12 vs ARM 15', () => {
    // Hit needs dice sum >= def - stat = 7  =>  21/36
    // Damage dealt = max(0, 2d6 + 12 - 15) = max(0, 2d6 - 3); this is 0 when 2d6 <= 3 (sums 2,3) => 3/36
    const odds = computeAttackOdds({
      attack: { type: 'melee', stat: 6 },
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
      attack: { type: 'melee', stat: 6 },
      damage: { pow: 12 },
      target: { def: 13, arm: 15, boxesRemaining: 1 },
    });
    const tough = computeAttackOdds({
      attack: { type: 'melee', stat: 6 },
      damage: { pow: 12 },
      target: { def: 13, arm: 15, boxesRemaining: 1, tough: true, toughOn: 5 },
    });
    // Tough on 5+ survives 2/6 of the time => fails (and is destroyed) 4/6 of the time.
    expect(tough.destroyChance).toBeCloseTo(base.destroyChance * (4 / 6), 9);
  });

  it('an auto-hit target (Stationary) always hits and cannot crit', () => {
    const odds = computeAttackOdds({
      attack: { type: 'melee', stat: 6, autoHit: true },
      damage: { pow: 10 },
      target: { def: 20, arm: 10, boxesRemaining: 1 },
    });
    expect(odds.hitChance).toBe(1);
    expect(odds.critOnHitChance).toBe(0);
  });

  it('a Knocked Down target auto-hits a melee attack but not a ranged one', () => {
    const melee = computeAttackOdds({
      attack: { type: 'melee', stat: 6 },
      damage: { pow: 10 },
      target: { def: 20, arm: 10, boxesRemaining: 1, knockedDown: true },
    });
    expect(melee.hitChance).toBe(1);

    const ranged = computeAttackOdds({
      attack: { type: 'ranged', stat: 6 },
      damage: { pow: 10 },
      target: { def: 20, arm: 10, boxesRemaining: 1, knockedDown: true },
    });
    expect(ranged.hitChance).toBeLessThan(1);
  });

  it('Brutal Damage adds extra dice only on the crit branch, raising expected damage over a plain crit', () => {
    const withoutBrutal = computeAttackOdds({
      attack: { type: 'melee', stat: 6 },
      damage: { pow: 12 },
      target: { def: 7, arm: 0, boxesRemaining: 1000 }, // low DEF/ARM: hits and crits are common, nothing gets destroyed mid-check
    });
    const withBrutal = computeAttackOdds({
      attack: { type: 'melee', stat: 6 },
      damage: { pow: 12 },
      effects: { brutalDamageDice: 2 },
      target: { def: 7, arm: 0, boxesRemaining: 1000 },
    });

    expect(withBrutal.hitChance).toBeCloseTo(withoutBrutal.hitChance, 9); // to-hit is unaffected
    expect(withBrutal.expectedDamage).toBeGreaterThan(withoutBrutal.expectedDamage);
  });

  it('reroll on the attack roll matches the hand-computed "reroll on a miss" formula', () => {
    // MAT 6 vs DEF 13: needed sum = 7, hitChance = 21/36 (the same case used elsewhere).
    const plain = computeAttackOdds({
      attack: { type: 'melee', stat: 6 },
      damage: { pow: 12 },
      target: { def: 13, arm: 15, boxesRemaining: 1000 },
    });
    const withReroll = computeAttackOdds({
      attack: { type: 'melee', stat: 6, modifiers: { reroll: true } },
      damage: { pow: 12 },
      target: { def: 13, arm: 15, boxesRemaining: 1000 },
    });

    // Reroll-on-miss: P(hit) = P(hit) + P(miss) * P(hit) = hitChance * (2 - hitChance).
    const expected = plain.hitChance * (2 - plain.hitChance);
    expect(withReroll.hitChance).toBeCloseTo(expected, 9);
    expect(withReroll.hitChance).toBeGreaterThan(plain.hitChance);
  });

  it('reroll on the attack roll still lets a rerolled natural-6s auto-hit crit (does not wipe out hasDouble)', () => {
    // MAT 1 vs DEF 30: needed sum = 29, unreachable normally, but a natural (6,6) auto-hits and crits (1/36).
    // A reroll can only ever add MORE ways to reach that same auto-hit-and-crit outcome, never remove it.
    const plain = computeAttackOdds({
      attack: { type: 'melee', stat: 1 },
      damage: { pow: 10 },
      target: { def: 30, arm: 0, boxesRemaining: 1000 },
    });
    const withReroll = computeAttackOdds({
      attack: { type: 'melee', stat: 1, modifiers: { reroll: true } },
      damage: { pow: 10 },
      target: { def: 30, arm: 0, boxesRemaining: 1000 },
    });
    expect(withReroll.critOnHitChance).toBeGreaterThanOrEqual(plain.critOnHitChance);
    expect(withReroll.hitChance).toBeGreaterThanOrEqual(plain.hitChance);
  });

  it('reroll on the damage roll raises expected damage (rerolls anything below average)', () => {
    const plain = computeAttackOdds({
      attack: { type: 'melee', stat: 6, autoHit: true },
      damage: { pow: 12 },
      target: { def: 13, arm: 0, boxesRemaining: 1000 },
    });
    const withReroll = computeAttackOdds({
      attack: { type: 'melee', stat: 6, autoHit: true },
      damage: { pow: 12, modifiers: { reroll: true } },
      target: { def: 13, arm: 0, boxesRemaining: 1000 },
    });
    expect(withReroll.expectedDamage).toBeGreaterThan(plain.expectedDamage);
  });

  it('"treat 1s as 6s" (Jump the Shark) on the attack roll can only ever help the hit chance', () => {
    const plain = computeAttackOdds({
      attack: { type: 'melee', stat: 6 },
      damage: { pow: 12 },
      target: { def: 13, arm: 15, boxesRemaining: 1000 },
    });
    const withJts = computeAttackOdds({
      attack: { type: 'melee', stat: 6, modifiers: { treatOnesAsSixes: true } },
      damage: { pow: 12 },
      target: { def: 13, arm: 15, boxesRemaining: 1000 },
    });
    expect(withJts.hitChance).toBeGreaterThan(plain.hitChance);
  });

  it('Sanguine Fate (extra crit-only die) raises crit chance without changing hit chance', () => {
    const plain = computeAttackOdds({
      attack: { type: 'melee', stat: 6 },
      damage: { pow: 12 },
      target: { def: 13, arm: 15, boxesRemaining: 1000 },
    });
    const withSanguineFate = computeAttackOdds({
      attack: { type: 'melee', stat: 6, modifiers: { extraCritDice: 1 } },
      damage: { pow: 12 },
      target: { def: 13, arm: 15, boxesRemaining: 1000 },
    });
    expect(withSanguineFate.hitChance).toBeCloseTo(plain.hitChance, 9);
    expect(withSanguineFate.critOnHitChance).toBeGreaterThan(plain.critOnHitChance);
  });

  it('an attack roll of all 1s is always a miss, even when MAT/DEF would otherwise guarantee a hit', () => {
    // MAT 20 vs DEF 1: needed dice sum = 1 - 20 = -19, so normally every possible roll hits.
    const odds = computeAttackOdds({
      attack: { type: 'melee', stat: 20 },
      damage: { pow: 10 },
      target: { def: 1, arm: 0, boxesRemaining: 1000 },
    });
    // Only (1,1) - 1/36 - is forced to miss.
    expect(odds.hitChance).toBeCloseTo(35 / 36, 9);
    expect(odds.missChance).toBeCloseTo(1 / 36, 9);
  });

  it('an attack roll of all 6s is always a hit, even when MAT/DEF would otherwise guarantee a miss', () => {
    // MAT 1 vs DEF 30: needed dice sum = 29, unreachable by 2d6 (max 12), so normally every roll misses.
    const odds = computeAttackOdds({
      attack: { type: 'melee', stat: 1 },
      damage: { pow: 10 },
      target: { def: 30, arm: 0, boxesRemaining: 1000 },
    });
    // Only (6,6) - 1/36 - is forced to hit, and it's necessarily also a double (a crit).
    expect(odds.hitChance).toBeCloseTo(1 / 36, 9);
    expect(odds.critOnHitChance).toBeCloseTo(1 / 36, 9);
  });

  it('the all-6s auto-hit exception does not apply when only one die is kept', () => {
    // Discarding the lowest of 2 dice keeps a single die (1-6) - MAT 1 vs DEF 30 still needs
    // a dice sum of 29, unreachable by a single die, so a lone 6 must NOT auto-hit here.
    const odds = computeAttackOdds({
      attack: { type: 'melee', stat: 1, modifiers: { discard: { lowest: 1 } } },
      damage: { pow: 10 },
      target: { def: 30, arm: 0, boxesRemaining: 1000 },
    });
    expect(odds.hitChance).toBe(0);
  });

  it('all 1s still misses even with only one die kept (no exception on the miss side)', () => {
    // Discarding the highest of 2 dice keeps the lower die - MAT 20 vs DEF 1 would otherwise
    // guarantee a hit (needed sum = -19), but a kept die of 1 must still force a miss.
    const odds = computeAttackOdds({
      attack: { type: 'melee', stat: 20, modifiers: { discard: { highest: 1 } } },
      damage: { pow: 10 },
      target: { def: 1, arm: 0, boxesRemaining: 1000 },
    });
    // Kept die = min(d1, d2) = 1 whenever at least one die shows 1: 1 - (5/6)^2 = 11/36 of rolls.
    expect(odds.missChance).toBeCloseTo(11 / 36, 9);
    expect(odds.hitChance).toBeCloseTo(25 / 36, 9);
  });
});

describe('sequence engine', () => {
  const target = { def: 13, arm: 15, boxes: 5 };

  function attack(overrides: Partial<SequencedAttack> = {}): SequencedAttack {
    return {
      id: overrides.id ?? 'a',
      attackerName: 'Attacker',
      label: 'Attack',
      type: 'melee',
      stat: 7,
      pow: 14,
      ...overrides,
    };
  }

  it('a single-step sequence matches computeAttackOdds for the same inputs', () => {
    const single = computeAttackOdds({
      attack: { type: 'melee', stat: 7 },
      damage: { pow: 14 },
      target: { def: 13, arm: 15, boxesRemaining: 5 },
    });
    const seq = computeSequenceOdds([attack()], target);

    expect(seq.finalDestroyChance).toBeCloseTo(single.destroyChance, 9);
    expect(seq.steps[0].hitChance).toBeCloseTo(single.hitChance, 9);
    expect(seq.steps[0].critChance).toBeCloseTo(single.critOnHitChance, 9);
    expect(seq.steps[0].averageDamage).toBeCloseTo(single.expectedDamage, 9);
  });

  it('critChance and averageDamage match a hand-computed case (MAT 6 vs DEF 13, POW 12 vs ARM 15)', () => {
    // Same numbers as the hand-computed attack-model test: hit needs 2d6 >= 7 (21/36),
    // and among those, a double (crit) is 6/36 of all rolls, all of which are >= 7 anyway
    // since a double >= 7 requires face >= 4 (4,4/5,5/6,6) -> 3/36 of all rolls are hits AND doubles.
    const result = computeSequenceOdds(
      [attack({ id: 'a', stat: 6, pow: 12 })],
      { def: 13, arm: 15, boxes: 1000 }
    );
    expect(result.steps[0].hitChance).toBeCloseTo(21 / 36, 9);
    expect(result.steps[0].critChance).toBeCloseTo(3 / 36, 9);

    // Expected raw damage = P(hit) * E[max(0, 2d6 + 12 - 15) | hit] - matches computeAttackOdds's expectedDamage.
    const viaSingleAttack = computeAttackOdds({
      attack: { type: 'melee', stat: 6 },
      damage: { pow: 12 },
      target: { def: 13, arm: 15, boxesRemaining: 1000 },
    });
    expect(result.steps[0].averageDamage).toBeCloseTo(viaSingleAttack.expectedDamage, 9);
  });

  it('cumulative destroy chance never decreases and is monotonic across steps', () => {
    const attacks = [attack({ id: '1' }), attack({ id: '2' }), attack({ id: '3' })];
    const result = computeSequenceOdds(attacks, target);

    let prev = 0;
    for (const step of result.steps) {
      expect(step.cumulativeDestroyChance).toBeGreaterThanOrEqual(prev);
      prev = step.cumulativeDestroyChance;
    }
    expect(result.finalDestroyChance).toBeCloseTo(prev, 9);
  });

  it('more attacks in the sequence strictly increase (or maintain) the final destroy chance', () => {
    const oneAttack = computeSequenceOdds([attack({ id: '1' })], target);
    const threeAttacks = computeSequenceOdds(
      [attack({ id: '1' }), attack({ id: '2' }), attack({ id: '3' })],
      target
    );
    expect(threeAttacks.finalDestroyChance).toBeGreaterThan(oneAttack.finalDestroyChance);
  });

  it('probability mass is conserved: final destroy chance + survival distribution sums to 1', () => {
    const attacks = [attack({ id: '1' }), attack({ id: '2' })];
    const result = computeSequenceOdds(attacks, target);
    const survivalMass = result.survivalDistribution.reduce((acc, p) => acc + p.probability, 0);
    expect(result.finalDestroyChance + survivalMass).toBeCloseTo(1, 9);
  });

  it('Knockdown on a crit makes a later melee attack in the sequence auto-hit', () => {
    // Attack 1 keeps a normal, realistic chance to hit/crit (DEF 13). Attack 2 has an
    // absurdly low stat AND keeps only 1 die (discarding the other) so it could basically
    // never hit on its own - a single die is also exempt from the "natural 6s always hit"
    // rule (see attack-model.ts), so its baseline hit chance is genuinely ~0, not just low.
    // The only way it can hit here is if Knockdown from attack 1's crit carries over.
    const singleDieMods = { discard: { lowest: 1 } };
    const attacks: SequencedAttack[] = [
      attack({ id: '1', statEffects: [{ type: 'knockdown', trigger: 'crit' }] }),
      attack({ id: '2', type: 'melee', stat: -50, modifiers: singleDieMods }),
    ];
    const result = computeSequenceOdds(attacks, target);
    expect(result.steps[1].hitChance).toBeGreaterThan(0);
  });

  it('Knockdown does not grant a ranged attack an auto-hit against the same target', () => {
    const singleDieMods = { discard: { lowest: 1 } };
    const attacks: SequencedAttack[] = [
      attack({ id: '1', statEffects: [{ type: 'knockdown', trigger: 'crit' }] }),
      attack({ id: '2', type: 'ranged', stat: -50, modifiers: singleDieMods }),
    ];
    const result = computeSequenceOdds(attacks, target);
    expect(result.steps[1].hitChance).toBeCloseTo(0, 6);
  });

  it('attack order matters: a high-crit-chance Knockdown attack helps more when it goes first', () => {
    const knockdownFirst: SequencedAttack[] = [
      attack({ id: '1', statEffects: [{ type: 'knockdown', trigger: 'crit' }] }),
      attack({ id: '2', stat: 1 }), // weak attack that badly needs the auto-hit assist
    ];
    const knockdownSecond: SequencedAttack[] = [
      attack({ id: '1', stat: 1 }),
      attack({ id: '2', statEffects: [{ type: 'knockdown', trigger: 'crit' }] }),
    ];

    const firstResult = computeSequenceOdds(knockdownFirst, target);
    const secondResult = computeSequenceOdds(knockdownSecond, target);

    expect(firstResult.finalDestroyChance).toBeGreaterThan(secondResult.finalDestroyChance);
  });

  it('runs 10 chained attacks quickly (exact enumeration, no combinatorial blowup)', () => {
    const attacks = Array.from({ length: 10 }, (_, i) =>
      attack({ id: `${i}`, stat: 6 + (i % 3), pow: 12 + (i % 2) })
    );
    const bigTarget = { def: 14, arm: 16, boxes: 20 };

    const start = performance.now();
    const result = computeSequenceOdds(attacks, bigTarget);
    const elapsedMs = performance.now() - start;

    expect(result.steps).toHaveLength(10);
    expect(result.finalDestroyChance).toBeGreaterThan(0);
    expect(result.finalDestroyChance).toBeLessThanOrEqual(1);
    expect(elapsedMs).toBeLessThan(2000);
  });

  it('still runs 10 chained attacks quickly when the target has focus and fury points to spend', () => {
    const attacks = Array.from({ length: 10 }, (_, i) =>
      attack({ id: `${i}`, stat: 6 + (i % 3), pow: 12 + (i % 2) })
    );
    const bigTarget = { def: 14, arm: 16, boxes: 20, focusPoints: 3, furyPoints: 2 };

    const start = performance.now();
    const result = computeSequenceOdds(attacks, bigTarget);
    const elapsedMs = performance.now() - start;

    expect(result.steps).toHaveLength(10);
    expect(elapsedMs).toBeLessThan(2000);
  });
});

describe('sequence engine - target focus/fury resource points', () => {
  function attack(overrides: Partial<SequencedAttack> = {}): SequencedAttack {
    return {
      id: overrides.id ?? 'a',
      attackerName: 'Attacker',
      label: 'Attack',
      type: 'melee',
      stat: 7,
      pow: 14,
      ...overrides,
    };
  }

  it('a fury point can fully negate an otherwise-guaranteed-lethal hit', () => {
    // autoHit + POW 1 vs ARM 0 vs 1 box: damage is 2d6+1 (min 3), always lethal on its own.
    const lethalAttack = attack({ type: 'melee', stat: 6, pow: 1, forceAutoHit: true });
    const target = { def: 13, arm: 0, boxes: 1 };

    const withoutFury = computeSequenceOdds([lethalAttack], target);
    expect(withoutFury.finalDestroyChance).toBeCloseTo(1, 9);

    const withFury = computeSequenceOdds([lethalAttack], { ...target, furyPoints: 1 });
    expect(withFury.finalDestroyChance).toBeCloseTo(0, 9);
  });

  it('a focus point reduces damage by exactly 5, matching a hand-computed fraction', () => {
    // autoHit, POW 5 vs ARM 0 vs 7 boxes: damage = 2d6+5, range 7..17 -> always >= 7 -> always lethal unmitigated.
    // With one focus point: mitigated damage = 2d6 (5-5 cancels out), range 2..12 -> lethal only when 2d6 >= 7 (21/36).
    const attackDef = attack({ type: 'melee', stat: 6, pow: 5, forceAutoHit: true });
    const target = { def: 13, arm: 0, boxes: 7 };

    const withoutFocus = computeSequenceOdds([attackDef], target);
    expect(withoutFocus.finalDestroyChance).toBeCloseTo(1, 9);

    const withFocus = computeSequenceOdds([attackDef], { ...target, focusPoints: 1 });
    expect(withFocus.finalDestroyChance).toBeCloseTo(21 / 36, 9);
  });

  it('spends at most one point per attack: a single fury point cannot save the target twice', () => {
    // Two sequential guaranteed-lethal-alone hits (see fury test above) on a 1-box target, but only 1 fury point.
    const makeLethalAttack = (id: string) => attack({ id, type: 'melee', stat: 6, pow: 1, forceAutoHit: true });
    const target = { def: 13, arm: 0, boxes: 1, furyPoints: 1 };

    const result = computeSequenceOdds([makeLethalAttack('1'), makeLethalAttack('2')], target);

    expect(result.steps[0].destroyChanceAtThisStep).toBeCloseTo(0, 9); // saved by the fury point
    expect(result.steps[1].destroyChanceAtThisStep).toBeCloseTo(1, 9); // no fury left, guaranteed lethal
    expect(result.finalDestroyChance).toBeCloseTo(1, 9);
  });

  it('more focus or fury points never make the target worse off (weakly monotonic survival)', () => {
    const attacks = [
      attack({ id: '1', pow: 14 }),
      attack({ id: '2', type: 'ranged', pow: 10, statEffects: [{ type: 'knockdown', trigger: 'crit' }] }),
      attack({ id: '3', pow: 16 }),
    ];
    const baseTarget = { def: 13, arm: 14, boxes: 10 };

    const noResources = computeSequenceOdds(attacks, baseTarget);
    const withFocus = computeSequenceOdds(attacks, { ...baseTarget, focusPoints: 2 });
    const withFury = computeSequenceOdds(attacks, { ...baseTarget, furyPoints: 1 });
    const withBoth = computeSequenceOdds(attacks, { ...baseTarget, focusPoints: 2, furyPoints: 1 });

    expect(withFocus.finalDestroyChance).toBeLessThanOrEqual(noResources.finalDestroyChance);
    expect(withFury.finalDestroyChance).toBeLessThanOrEqual(noResources.finalDestroyChance);
    expect(withBoth.finalDestroyChance).toBeLessThanOrEqual(withFocus.finalDestroyChance);
    expect(withBoth.finalDestroyChance).toBeLessThanOrEqual(withFury.finalDestroyChance);
  });

  it('rejects an unrealistically large focus/fury pool', () => {
    const target = { def: 13, arm: 14, boxes: 10, focusPoints: 999 };
    expect(() => computeSequenceOdds([attack()], target)).toThrow();
  });
});

describe("sequence engine - target DEF: 'KD' (starts Knocked Down)", () => {
  function attack(overrides: Partial<SequencedAttack> = {}): SequencedAttack {
    return {
      id: overrides.id ?? 'a',
      attackerName: 'Attacker',
      label: 'Attack',
      type: 'melee',
      stat: 7,
      pow: 14,
      ...overrides,
    };
  }

  it("DEF: 'KD' makes a melee attack auto-hit regardless of its stat", () => {
    const result = computeSequenceOdds([attack({ stat: -50 })], { def: 'KD', arm: 15, boxes: 5 });
    expect(result.steps[0].hitChance).toBeCloseTo(1, 9);
  });

  it("DEF: 'KD' does NOT auto-hit ranged/arcane attacks - they still roll normally against DEF 5", () => {
    const ranged = computeSequenceOdds([attack({ type: 'ranged', stat: -50 })], { def: 'KD', arm: 15, boxes: 5 });
    const arcane = computeSequenceOdds([attack({ type: 'arcane', stat: -50 })], { def: 'KD', arm: 15, boxes: 5 });

    const viaExplicitDef5 = computeAttackOdds({
      attack: { type: 'ranged', stat: -50 },
      damage: { pow: 14 },
      target: { def: 5, arm: 15, boxesRemaining: 5 },
    });

    expect(ranged.steps[0].hitChance).toBeCloseTo(viaExplicitDef5.hitChance, 9);
    expect(arcane.steps[0].hitChance).toBeCloseTo(viaExplicitDef5.hitChance, 9);
    expect(ranged.steps[0].hitChance).toBeLessThan(1); // not an auto-hit
  });

  it("a melee attack still auto-hits from DEF: 'KD' even after an earlier ranged attack in the same sequence", () => {
    // Knocked Down is a property of the target from the very start of the sequence, not
    // something that has to be "re-triggered" - it shouldn't matter what came before it.
    const result = computeSequenceOdds(
      [attack({ id: '1', type: 'ranged', stat: -50 }), attack({ id: '2', type: 'melee', stat: -50 })],
      { def: 'KD', arm: 15, boxes: 1000 }
    );
    expect(result.steps[1].hitChance).toBeCloseTo(1, 9);
  });

  it("an auto-hit from DEF: 'KD' cannot crit (no attack roll is made)", () => {
    const result = computeSequenceOdds(
      [attack({ stat: -50, effects: { brutalDamageDice: 2 } })],
      { def: 'KD', arm: 0, boxes: 1000 }
    );
    // If it could crit, Brutal Damage would push expected damage up; confirm it behaves
    // identically to the same attack without Brutal Damage (i.e. the crit branch is unreachable).
    const withoutBrutal = computeSequenceOdds([attack({ stat: -50 })], { def: 'KD', arm: 0, boxes: 1000 });
    expect(result.steps[0].expectedBoxesRemaining).toBeCloseTo(withoutBrutal.steps[0].expectedBoxesRemaining, 9);
  });
});

describe('sequence engine - persistent target debuffs', () => {
  function attack(overrides: Partial<SequencedAttack> = {}): SequencedAttack {
    return {
      id: overrides.id ?? 'a',
      attackerName: 'Attacker',
      label: 'Attack',
      type: 'melee',
      stat: 7,
      pow: 14,
      ...overrides,
    };
  }

  it('Stationary auto-hits melee and floors ranged/arcane DEF to 5, exactly like Knockdown', () => {
    const target = { def: 13, arm: 15, boxes: 1000 };

    const melee = computeSequenceOdds(
      [
        attack({ id: '1', forceAutoHit: true, statEffects: [{ type: 'stationary', trigger: 'hit' }] }),
        attack({ id: '2', type: 'melee', stat: -50 }),
      ],
      target
    );
    expect(melee.steps[1].hitChance).toBeCloseTo(1, 9);

    const ranged = computeSequenceOdds(
      [
        attack({ id: '1', forceAutoHit: true, statEffects: [{ type: 'stationary', trigger: 'hit' }] }),
        attack({ id: '2', type: 'ranged', stat: 0 }),
      ],
      target
    );
    // DEF floored to 5, RAT 0 -> needed sum 5 -> P(2d6 >= 5) = 30/36.
    expect(ranged.steps[1].hitChance).toBeCloseTo(30 / 36, 9);
  });

  it('Ice Cage stacks -2 DEF per application and makes the target Stationary at 2+ stacks', () => {
    const target = { def: 13, arm: 0, boxes: 1000 };

    const oneStack = computeSequenceOdds(
      [
        attack({ id: '1', forceAutoHit: true, statEffects: [{ type: 'iceCage', trigger: 'hit' }] }),
        attack({ id: '2', type: 'ranged', stat: 6 }),
      ],
      target
    );
    // DEF 13-2=11, RAT 6, needed=5 -> 30/36.
    expect(oneStack.steps[1].hitChance).toBeCloseTo(30 / 36, 9);

    const twoStacks = computeSequenceOdds(
      [
        attack({
          id: '1',
          forceAutoHit: true,
          statEffects: [
            { type: 'iceCage', trigger: 'hit' },
            { type: 'iceCage', trigger: 'hit' },
          ],
        }),
        attack({ id: '2', type: 'melee', stat: -50 }),
      ],
      target
    );
    // 2 stacks -> Stationary -> melee auto-hits regardless of stat.
    expect(twoStacks.steps[1].hitChance).toBeCloseTo(1, 9);
  });

  it('Blind applies its fixed -4 DEF exactly once, even if triggered twice (non-stacking)', () => {
    const target = { def: 13, arm: 0, boxes: 1000 };
    const result = computeSequenceOdds(
      [
        attack({ id: '1', forceAutoHit: true, statEffects: [{ type: 'blind', trigger: 'hit' }] }),
        attack({ id: '2', forceAutoHit: true, statEffects: [{ type: 'blind', trigger: 'hit' }] }),
        attack({ id: '3', type: 'ranged', stat: 0 }),
      ],
      target
    );
    // DEF 13-4=9 (Blind counted once), RAT 0, needed=9 -> P(2d6>=9) = 10/36.
    expect(result.steps[2].hitChance).toBeCloseTo(10 / 36, 9);
  });

  it('Paralysis sets a base DEF of 5, and other flat DEF debuffs still subtract further on top', () => {
    const target = { def: 30, arm: 0, boxes: 1000 }; // high base DEF, irrelevant once Paralysis triggers
    const result = computeSequenceOdds(
      [
        attack({
          id: '1',
          forceAutoHit: true,
          statEffects: [
            { type: 'paralysis', trigger: 'hit' },
            { type: 'blind', trigger: 'hit' },
          ],
        }),
        attack({ id: '2', type: 'ranged', stat: 0 }),
      ],
      target
    );
    // DEF = 5 (Paralysis base) - 4 (Blind) = 1, RAT 0, needed = 1 -> hits on any roll except all-1s (1/36).
    expect(result.steps[1].hitChance).toBeCloseTo(35 / 36, 9);
  });

  it('generic ARM penalty ("-X ARM") persists and stacks across triggers', () => {
    const target = { def: 13, arm: 20, boxes: 1000 };
    const result = computeSequenceOdds(
      [
        attack({ id: '1', forceAutoHit: true, pow: 0, statEffects: [{ type: 'armPenalty', trigger: 'hit', amount: 5 }] }),
        attack({ id: '2', forceAutoHit: true, pow: 0, statEffects: [{ type: 'armPenalty', trigger: 'hit', amount: 3 }] }),
        attack({ id: '3', forceAutoHit: true, pow: 12 }),
      ],
      target
    );
    // Effective ARM for attack 3 = 20 - 5 - 3 = 12 = POW, so damage dealt = raw 2d6 sum every time.
    expect(result.steps[2].averageDamage).toBeCloseTo(7, 9);
  });

  it('Armor Piercing halves only the printed BASE ARM; an existing ARM debuff still applies on top', () => {
    const target = { def: 13, arm: 15, boxes: 1000 };
    const result = computeSequenceOdds(
      [
        attack({ id: '1', forceAutoHit: true, pow: 0, statEffects: [{ type: 'armPenalty', trigger: 'hit', amount: 5 }] }), // effective ARM now 10
        attack({ id: '2', forceAutoHit: true, pow: 12, effects: { armorPiercing: 'hit' } }),
      ],
      target
    );
    // ceil(15/2)=8 (BASE ARM 15, halved) + (10-15)=-5 (the existing debuff, still applied) = 3.
    // averageDamage = E[2d6] + 12 - 3 = 7 + 9 = 16.
    expect(result.steps[1].averageDamage).toBeCloseTo(16, 9);
  });

  it("Decapitation doubles this attack's damage", () => {
    const target = { def: 13, arm: 15, boxes: 1000 };
    const plain = computeSequenceOdds([attack({ forceAutoHit: true, pow: 12 })], target);
    const withDecap = computeSequenceOdds(
      [attack({ forceAutoHit: true, pow: 12, effects: { decapitation: 'hit' } })],
      target
    );
    expect(withDecap.steps[0].averageDamage).toBeCloseTo(plain.steps[0].averageDamage * 2, 9);
  });

  it('Trash adds an extra damage die only once the target is actually Knocked Down', () => {
    const target = { def: 13, arm: 15, boxes: 1000 };
    const plain = computeSequenceOdds([attack({ forceAutoHit: true, pow: 12 })], target);
    const trashNotYetKD = computeSequenceOdds(
      [attack({ forceAutoHit: true, pow: 12, effects: { trash: true } })],
      target
    );
    expect(trashNotYetKD.steps[0].averageDamage).toBeCloseTo(plain.steps[0].averageDamage, 9);

    const withoutTrash = computeSequenceOdds(
      [
        attack({ id: '1', forceAutoHit: true, statEffects: [{ type: 'knockdown', trigger: 'hit' }] }),
        attack({ id: '2', forceAutoHit: true, pow: 12 }),
      ],
      target
    );
    const withTrash = computeSequenceOdds(
      [
        attack({ id: '1', forceAutoHit: true, statEffects: [{ type: 'knockdown', trigger: 'hit' }] }),
        attack({ id: '2', forceAutoHit: true, pow: 12, effects: { trash: true } }),
      ],
      target
    );
    expect(withTrash.steps[1].averageDamage).toBeGreaterThan(withoutTrash.steps[1].averageDamage);
  });

  it('Shatter adds an extra damage die only once the target is actually Stationary', () => {
    const target = { def: 13, arm: 15, boxes: 1000 };
    const withoutShatter = computeSequenceOdds(
      [
        attack({ id: '1', forceAutoHit: true, statEffects: [{ type: 'stationary', trigger: 'hit' }] }),
        attack({ id: '2', forceAutoHit: true, pow: 12 }),
      ],
      target
    );
    const withShatter = computeSequenceOdds(
      [
        attack({ id: '1', forceAutoHit: true, statEffects: [{ type: 'stationary', trigger: 'hit' }] }),
        attack({ id: '2', forceAutoHit: true, pow: 12, effects: { shatter: true } }),
      ],
      target
    );
    expect(withShatter.steps[1].averageDamage).toBeGreaterThan(withoutShatter.steps[1].averageDamage);
  });

  it('a "hit" trigger fires on any hit including non-crit, a "crit" trigger only fires on a crit', () => {
    const target = { def: 13, arm: 20, boxes: 1000 };
    const hitTrigger = computeSequenceOdds(
      [
        attack({ id: '1', pow: 0, statEffects: [{ type: 'armPenalty', trigger: 'hit', amount: 10 }] }),
        attack({ id: '2', forceAutoHit: true, pow: 12 }),
      ],
      target
    );
    const critTrigger = computeSequenceOdds(
      [
        attack({ id: '1', pow: 0, statEffects: [{ type: 'armPenalty', trigger: 'crit', amount: 10 }] }),
        attack({ id: '2', forceAutoHit: true, pow: 12 }),
      ],
      target
    );
    // 'hit' fires on strictly more outcomes (any hit) than 'crit' (crit only), so more expected ARM
    // reduction reaches attack 2 -> strictly higher average damage for the 'hit' variant.
    expect(hitTrigger.steps[1].averageDamage).toBeGreaterThan(critTrigger.steps[1].averageDamage);
  });
});

describe('sequence engine - target capabilities (Tough Steady, Unyielding, Carapace, spell/Shield bonuses)', () => {
  function attack(overrides: Partial<SequencedAttack> = {}): SequencedAttack {
    return {
      id: overrides.id ?? 'a',
      attackerName: 'Attacker',
      label: 'Attack',
      type: 'melee',
      stat: 7,
      pow: 14,
      ...overrides,
    };
  }

  it('plain Tough is negated once the target is Knocked Down (the tabletop rule the engine did not model before)', () => {
    const target = { def: 13, arm: 0, boxes: 1, tough: true, toughOn: 5 };

    const withoutKnockdownFirst = computeSequenceOdds([attack({ forceAutoHit: true, pow: 100 })], target);
    // Tough on 5+ survives 2/6 of the time while NOT Knocked Down -> fails (destroyed) 4/6 of the time.
    expect(withoutKnockdownFirst.finalDestroyChance).toBeCloseTo(4 / 6, 9);

    // boxes=50 here (not 1): attack 1's own damage (pow 0, arm 0, 2d6 -> 2..12) must stay strictly
    // non-lethal on its own, or its Tough roll would also be exercised and muddy the result - only
    // attack 2's massive pow:100 hit (always >= 102) should ever be lethal in this scenario.
    const withKnockdownFirst = computeSequenceOdds(
      [
        attack({ id: '1', forceAutoHit: true, pow: 0, statEffects: [{ type: 'knockdown', trigger: 'hit' }] }),
        attack({ id: '2', forceAutoHit: true, pow: 100 }),
      ],
      { ...target, boxes: 50 }
    );
    // The target is already Knocked Down when attack 2's lethal damage lands, so plain Tough
    // can't be attempted at all -> guaranteed destruction, not the usual 4/6.
    expect(withKnockdownFirst.finalDestroyChance).toBeCloseTo(1, 9);
  });

  it('Tough Steady still applies even while Knocked Down, unlike plain Tough', () => {
    const target = { def: 13, arm: 0, boxes: 50, toughSteady: true, toughOn: 5 }; // boxes=50: see comment above
    const result = computeSequenceOdds(
      [
        attack({ id: '1', forceAutoHit: true, pow: 0, statEffects: [{ type: 'knockdown', trigger: 'hit' }] }),
        attack({ id: '2', forceAutoHit: true, pow: 100 }),
      ],
      target
    );
    // Same 4/6 fail chance as plain Tough gets when NOT Knocked Down - Tough Steady is immune
    // to the negation plain Tough just suffered in the previous test.
    expect(result.finalDestroyChance).toBeCloseTo(4 / 6, 9);
  });

  it('Unyielding adds +2 ARM against melee attacks only', () => {
    const withUnyielding = { def: 13, arm: 10, boxes: 1000, unyielding: true };
    const plain = { def: 13, arm: 10, boxes: 1000 };

    const meleeWith = computeSequenceOdds([attack({ forceAutoHit: true, pow: 12 })], withUnyielding);
    const meleeWithout = computeSequenceOdds([attack({ forceAutoHit: true, pow: 12 })], plain);
    expect(meleeWith.steps[0].averageDamage).toBeCloseTo(meleeWithout.steps[0].averageDamage - 2, 9);

    const rangedWith = computeSequenceOdds([attack({ type: 'ranged', forceAutoHit: true, pow: 12 })], withUnyielding);
    const rangedWithout = computeSequenceOdds([attack({ type: 'ranged', forceAutoHit: true, pow: 12 })], plain);
    expect(rangedWith.steps[0].averageDamage).toBeCloseTo(rangedWithout.steps[0].averageDamage, 9); // no bonus vs ranged
  });

  it('Carapace adds +4 ARM against ranged attacks only', () => {
    const withCarapace = { def: 13, arm: 10, boxes: 1000, carapace: true };
    const plain = { def: 13, arm: 10, boxes: 1000 };

    const rangedWith = computeSequenceOdds([attack({ type: 'ranged', forceAutoHit: true, pow: 12 })], withCarapace);
    const rangedWithout = computeSequenceOdds([attack({ type: 'ranged', forceAutoHit: true, pow: 12 })], plain);
    expect(rangedWith.steps[0].averageDamage).toBeCloseTo(rangedWithout.steps[0].averageDamage - 4, 9);

    const meleeWith = computeSequenceOdds([attack({ forceAutoHit: true, pow: 12 })], withCarapace);
    const meleeWithout = computeSequenceOdds([attack({ forceAutoHit: true, pow: 12 })], plain);
    expect(meleeWith.steps[0].averageDamage).toBeCloseTo(meleeWithout.steps[0].averageDamage, 9); // no bonus vs melee
  });

  it('shieldArmBonus (Shield) is a flat, unconditional ARM bonus', () => {
    const target = { def: 13, arm: 10, boxes: 1000, shieldArmBonus: 3 };
    const base = { def: 13, arm: 10, boxes: 1000 };
    const withBonus = computeSequenceOdds([attack({ forceAutoHit: true, pow: 12 })], target);
    const without = computeSequenceOdds([attack({ forceAutoHit: true, pow: 12 })], base);
    expect(withBonus.steps[0].averageDamage).toBeCloseTo(without.steps[0].averageDamage - 3, 9);
  });

  it('spellArmBonus (generic spell ARM bonus) is a flat, unconditional ARM bonus', () => {
    const target = { def: 13, arm: 10, boxes: 1000, spellArmBonus: 3 };
    const base = { def: 13, arm: 10, boxes: 1000 };
    const withBonus = computeSequenceOdds([attack({ forceAutoHit: true, pow: 12 })], target);
    const without = computeSequenceOdds([attack({ forceAutoHit: true, pow: 12 })], base);
    expect(withBonus.steps[0].averageDamage).toBeCloseTo(without.steps[0].averageDamage - 3, 9);
  });

  it('defBonus (generic spell DEF bonus) is a flat, unconditional DEF bonus', () => {
    const target = { def: 10, arm: 0, boxes: 1000, defBonus: 2 };
    const result = computeSequenceOdds([attack({ type: 'ranged', stat: 0 })], target);
    // Effective DEF = 10+2 = 12, RAT 0, needed sum = 12 -> P(2d6 = 12) = 1/36.
    expect(result.steps[0].hitChance).toBeCloseTo(1 / 36, 9);
  });

  it('Armor Piercing still applies ARM buffs too (Shield/spell/Unyielding/Carapace) on top of the halved base', () => {
    const target = { def: 13, arm: 16, boxes: 1000, shieldArmBonus: 4, unyielding: true };
    const result = computeSequenceOdds(
      [attack({ forceAutoHit: true, pow: 12, effects: { armorPiercing: 'hit' } })],
      target
    );
    // Effective ARM (no Armor Piercing) would be 16 + 4 (Shield) + 2 (Unyielding, melee) = 22.
    // Armor Piercing halves only the printed base: ceil(16/2)=8, then adds back the +6 of
    // buffs still in play (22-16) = 14. averageDamage = E[2d6] + 12 - 14 = 7 - 2 = 5.
    expect(result.steps[0].averageDamage).toBeCloseTo(5, 9);
  });

  it('Blessed ignores every Stat-type spell bonus (DEF and ARM), but not Shield', () => {
    const target = { def: 10, arm: 10, boxes: 1000, spellArmBonus: 3, defBonus: 2, shieldArmBonus: 5 };
    const blessed = computeSequenceOdds([attack({ forceAutoHit: true, pow: 12, blessed: true })], target);
    const notBlessed = computeSequenceOdds([attack({ forceAutoHit: true, pow: 12 })], target);
    const shieldOnly = computeSequenceOdds(
      [attack({ forceAutoHit: true, pow: 12, blessed: true })],
      { def: 10, arm: 10, boxes: 1000, shieldArmBonus: 5 }
    );
    // Blessed drops the +3 spellArmBonus (only Shield's +5 ARM remains), and DEF has no effect on
    // averageDamage with forceAutoHit - so a Blessed attack should match an attack against a target
    // with Shield alone.
    expect(blessed.steps[0].averageDamage).toBeCloseTo(shieldOnly.steps[0].averageDamage, 9);
    expect(blessed.steps[0].averageDamage).not.toBeCloseTo(notBlessed.steps[0].averageDamage, 9);
  });

  it('Chain Weapon ignores Shield ARM bonus specifically, but not spell stat bonuses', () => {
    const target = { def: 10, arm: 10, boxes: 1000, spellArmBonus: 3, shieldArmBonus: 5 };
    const chainWeapon = computeSequenceOdds([attack({ forceAutoHit: true, pow: 12, chainWeapon: true })], target);
    const spellOnly = computeSequenceOdds(
      [attack({ forceAutoHit: true, pow: 12 })],
      { def: 10, arm: 10, boxes: 1000, spellArmBonus: 3 }
    );
    expect(chainWeapon.steps[0].averageDamage).toBeCloseTo(spellOnly.steps[0].averageDamage, 9);
  });

  it('Dispel removes every currently-Dispellable spell bonus/rule for the rest of the sequence, but not innate ones', () => {
    // Attack 1 knocks nothing down and never lethal (boxes far above its max damage); its own
    // Dispel effect fires on hit and should only affect attack 2's resolution, not attack 1's own.
    const attack1 = attack({ forceAutoHit: true, pow: 0, statEffects: [{ type: 'dispel', trigger: 'hit' }] });
    const attack2 = attack({ forceAutoHit: true, pow: 12 });
    const target = {
      def: 10,
      arm: 10,
      boxes: 1000,
      spellArmBonus: 3,
      spellArmBonusPostDispel: 0,
      defBonus: 2,
      defBonusPostDispel: 0,
      unyielding: true,
      unyieldingPostDispel: false,
      shieldArmBonus: 5, // innate - Dispel never touches shieldArmBonus (see SequenceTarget doc)
    };
    const result = computeSequenceOdds([attack1, attack2], target);
    const withoutDispellables = computeSequenceOdds(
      [attack1, attack({ forceAutoHit: true, pow: 12 })],
      { def: 10, arm: 10, boxes: 1000, shieldArmBonus: 5 }
    );
    // Attack 2 sees only Shield's ARM bonus once Dispel has fired before it - matches a target that
    // never had the dispellable spell ARM bonus or Unyielding in the first place.
    expect(result.steps[1].averageDamage).toBeCloseTo(withoutDispellables.steps[1].averageDamage, 9);
  });
});

describe('sequence engine - Rapid Healing and Grievous Wounds', () => {
  function attack(overrides: Partial<SequencedAttack> = {}): SequencedAttack {
    return {
      id: overrides.id ?? 'a',
      attackerName: 'Attacker',
      label: 'Attack',
      type: 'melee',
      stat: 7,
      pow: 14,
      ...overrides,
    };
  }

  it('Rapid Healing adds E[d3]=2 expected boxes back after a non-lethal hit', () => {
    const target = { def: 10, arm: 0, boxes: 1000, rapidHealing: true };
    const withHealing = computeSequenceOdds([attack({ forceAutoHit: true, pow: 12 })], target);
    const without = computeSequenceOdds([attack({ forceAutoHit: true, pow: 12 })], { def: 10, arm: 0, boxes: 1000 });
    // Damage = 2d6+12, always far below 1000 boxes and always far below the 1000 cap even after
    // a max +3 heal, so the cap never kicks in here - the only difference is the heal itself.
    expect(withHealing.steps[0].expectedBoxesRemaining).toBeCloseTo(without.steps[0].expectedBoxesRemaining + 2, 9);
  });

  it("Rapid Healing's heal never brings the target above its starting box count", () => {
    const target = { def: 10, arm: 11, boxes: 2, rapidHealing: true };
    const withHealing = computeSequenceOdds([attack({ forceAutoHit: true, pow: 0 })], target);
    const without = computeSequenceOdds([attack({ forceAutoHit: true, pow: 0 })], { def: 10, arm: 11, boxes: 2 });
    // Damage = max(0, 2d6-11): 0 except on a natural 12 (1/36), which deals exactly 1 (non-lethal,
    // boxes=2). Without healing that 1/36 chance leaves the target at 1 box: expected = 2 - 1/36.
    // With healing, every one of the 3 possible heal rolls (1, 2, or 3) taken from 1 box gets
    // capped right back at the starting 2 - so the target is deterministically at full boxes.
    expect(without.steps[0].expectedBoxesRemaining).toBeCloseTo(2 - 1 / 36, 9);
    expect(withHealing.steps[0].expectedBoxesRemaining).toBeCloseTo(2, 9);
  });

  it('Rapid Healing does not trigger when no damage gets through at all', () => {
    const target = { def: 13, arm: 20, boxes: 1000, rapidHealing: true };
    // ARM 20 exceeds even the maximum possible 2d6+0 damage roll (12), so damageDealt is always 0
    // whether this attack hits or misses (a natural double-6 always hits, regardless of DEF - so
    // "always misses" isn't achievable here, but "always deals 0 damage" is, and that's what
    // actually gates the heal): expectedBoxesRemaining stays exactly at the start.
    const result = computeSequenceOdds([attack({ pow: 0 })], target);
    expect(result.steps[0].expectedBoxesRemaining).toBeCloseTo(1000, 9);
  });

  it('Rapid Healing still triggers on a Fury-negated hit, since the RAW damage (before mitigation) was nonzero', () => {
    // boxes=30 is sized so neither heal (max +3 each, twice) ever gets near the 30 cap: attack1's
    // damage (2d6+10, 12-22) always leaves at least 8 boxes of headroom before any healing, and
    // attack2's own heal on top of that still tops out at 27 - so the +4 expected below is exact,
    // not just approximate (no capping edge case muddies it, unlike a naive boxes=20 attempt).
    const target = { def: 13, arm: 0, boxes: 30, furyPoints: 1, rapidHealing: true };
    const attack1 = attack({ id: '1', forceAutoHit: true, pow: 10 }); // damage = 2d6+10 (12-22), never lethal (< 30)
    const attack2 = attack({ id: '2', forceAutoHit: true, pow: 30 }); // damage = 2d6+30 (32-42), always lethal without the one Fury point
    const withHealing = computeSequenceOdds([attack1, attack2], target);
    const withoutHealing = computeSequenceOdds([attack1, attack2], { def: 13, arm: 0, boxes: 30, furyPoints: 1 });
    // The target is forced to spend its one Fury point on attack2 regardless of Rapid Healing (not
    // spending it means certain destruction, which always dominates any box-count tiebreak) - so
    // both runs make the exact same Focus/Fury choice, and Fury negates attack2's damage to 0 in
    // both. The only difference is Rapid Healing itself: it adds E[d3]=2 boxes after attack1
    // (whose raw damage is always > 0) and another 2 after attack2 - triggered by attack2's raw
    // damage (2d6+30), even though the mitigated damage that actually reached boxes was 0.
    expect(withHealing.steps[1].expectedBoxesRemaining).toBeCloseTo(withoutHealing.steps[1].expectedBoxesRemaining + 4, 9);
  });

  it('Grievous Wounds removes Tough (and Tough Steady) for the rest of the sequence', () => {
    const target = { def: 13, arm: 0, boxes: 50, tough: true, toughOn: 5 };
    const attack1 = attack({
      id: '1',
      forceAutoHit: true,
      pow: 0,
      statEffects: [{ type: 'grievousWounds', trigger: 'hit' }],
    });
    const attack2 = attack({ id: '2', forceAutoHit: true, pow: 100 });
    const withGrievousWounds = computeSequenceOdds([attack1, attack2], target);
    const withoutGrievousWounds = computeSequenceOdds([attack({ id: '1', forceAutoHit: true, pow: 0 }), attack2], target);
    // Without Grievous Wounds, Tough still gives attack2 a 4/6 chance to survive (toughOn 5+).
    // With it, Tough no longer applies at all - attack2 is always lethal.
    expect(withoutGrievousWounds.steps[1].destroyChanceAtThisStep).toBeCloseTo(4 / 6, 9);
    expect(withGrievousWounds.steps[1].destroyChanceAtThisStep).toBeCloseTo(1, 9);
  });

  it('Grievous Wounds removes Tough Steady too, unlike the Knocked Down negation it is otherwise immune to', () => {
    const target = { def: 13, arm: 0, boxes: 50, toughSteady: true, toughOn: 5 };
    const attack1 = attack({
      id: '1',
      forceAutoHit: true,
      pow: 0,
      statEffects: [{ type: 'grievousWounds', trigger: 'hit' }],
    });
    const attack2 = attack({ id: '2', forceAutoHit: true, pow: 100 });
    const result = computeSequenceOdds([attack1, attack2], target);
    expect(result.steps[1].destroyChanceAtThisStep).toBeCloseTo(1, 9);
  });

  it('Grievous Wounds also disables Rapid Healing, including on the very hit that inflicts it', () => {
    const target = { def: 10, arm: 0, boxes: 1000, rapidHealing: true };
    const withoutWound = computeSequenceOdds([attack({ forceAutoHit: true, pow: 5 })], target);
    const withWound = computeSequenceOdds(
      [attack({ forceAutoHit: true, pow: 5, statEffects: [{ type: 'grievousWounds', trigger: 'hit' }] })],
      target
    );
    // Same damage roll (2d6+5) either way; only the heal differs. Without the wound, healing adds
    // E[d3]=2 on top; the wound (inflicted by this same hit) suppresses it entirely.
    expect(withoutWound.steps[0].expectedBoxesRemaining).toBeCloseTo(withWound.steps[0].expectedBoxesRemaining + 2, 9);
  });
});

describe('sequence engine - Critical Shred', () => {
  function attack(overrides: Partial<SequencedAttack> = {}): SequencedAttack {
    return {
      id: overrides.id ?? 'a',
      attackerName: 'Attacker',
      label: 'Attack',
      type: 'melee',
      stat: 7,
      pow: 14,
      ...overrides,
    };
  }

  it('baseline without Critical Shred: average damage is just this one roll (sanity check for the next test)', () => {
    const target = { def: 2, arm: 0, boxes: 1000 };
    // Needed sum = 2-20 = -18: every roll except the forced-miss double-1s (see attack-model.ts's
    // "a roll of all 1s is always a miss" rule) is a hit, so hitChance = 35/36. The damage roll is
    // a SEPARATE, independent 2d6 roll from the to-hit roll (see attack-model.ts), so it isn't
    // affected by which specific to-hit combo landed the hit - averageDamage is simply
    // hitChance * E[2d6] = (35/36) * 7 = 245/36.
    const result = computeSequenceOdds([attack({ stat: 20, pow: 0 })], target);
    expect(result.steps[0].averageDamage).toBeCloseTo(245 / 36, 9);
  });

  it('extends average damage into a geometric series over the crit chance', () => {
    const target = { def: 2, arm: 0, boxes: 1000 };
    // Same target/attack as the baseline above, plus Critical Shred. Crit chance here is 5/36
    // (every double except the forced-miss 1-1: 2-2, 3-3, 4-4, 5-5, 6-6). ARM/DEF never change
    // across the chain (no statEffects configured), so every instance has the same expected
    // damage (245/36, from the baseline) and the same crit chance - the chain's expected TOTAL
    // damage is therefore an exact geometric series: (245/36) * sum_i (5/36)^i = (245/36) / (1 - 5/36) = 245/31.
    // Precision 8 (not 9, like every other test here) because this specific value is the one place
    // MAX_SHRED_DEPTH's truncation actually shows up: the untruncated series is infinite, but the
    // engine sums only 11 terms - the gap is (5/36)^11 worth of the tail, ~3e-9, well under
    // anything the UI could ever display, but just above a 9-decimal-place tolerance.
    const result = computeSequenceOdds([attack({ stat: 20, pow: 0, criticalShred: true })], target);
    expect(result.steps[0].averageDamage).toBeCloseTo(245 / 31, 8);
  });

  it('Hit/Crit chance stay the ORIGINAL roll\'s own probability, not inflated by the chain', () => {
    const target = { def: 2, arm: 0, boxes: 1000 };
    const result = computeSequenceOdds([attack({ stat: 20, pow: 0, criticalShred: true })], target);
    expect(result.steps[0].hitChance).toBeCloseTo(35 / 36, 9);
    expect(result.steps[0].critChance).toBeCloseTo(5 / 36, 9);
  });

  it('resolves each chain instance against the UPDATED debuff state (a crit-triggered Knockdown auto-hits the next instance)', () => {
    const target = { def: 13, arm: 0, boxes: 1000 };
    const shredKnockdown = attack({
      type: 'melee',
      stat: 0,
      pow: 0,
      criticalShred: true,
      statEffects: [{ type: 'knockdown', trigger: 'crit' }],
    });
    const result = computeSequenceOdds([shredKnockdown], target);
    // Needed sum = 13, impossible except via the "a natural 12 always hits" rule - so the only
    // way to hit is a 6-6 (probability 1/36), which is necessarily also a crit, and inflicts
    // Knockdown. The damage roll is a SEPARATE, independent 2d6 roll from the to-hit roll (see
    // attack-model.ts), so this hit's own damage is E[2d6]=7, not the to-hit roll's own sum of 12.
    // Since this attack has Critical Shred, a second instance immediately resolves against the
    // now-Knocked-Down target: a melee attack against a Knocked Down target auto-hits (no roll at
    // all, and per the auto-hit rule can never itself crit, so the chain stops there), dealing its
    // own fresh, independent 2d6 damage roll (E[2d6]=7 again). If the recursion incorrectly reused
    // the STALE (not-yet-knocked-down) debuff state instead, the second instance would need
    // another 1/36 natural-12 roll instead of auto-hitting - a very different (much smaller)
    // number, so this genuinely distinguishes the two.
    // Total: P(6-6) * (E[2d6] + E[2d6]) = (1/36) * 14 = 14/36 = 7/18.
    expect(result.steps[0].averageDamage).toBeCloseTo(7 / 18, 9);
  });

  it('a lethal hit within the chain can still destroy the target, ending the chain early', () => {
    const target = { def: 2, arm: 0, boxes: 1, furyPoints: 0 };
    // Needed sum = -18 as in the tests above: every roll but the forced-miss 1-1 is a hit, and
    // any hit deals at least 1 damage (min roll 2, pow -1... use pow 0, min hit sum among the
    // remaining 35 rolls is 3) against 1 box, so every hit is lethal and destroys the target
    // immediately - Critical Shred never gets a chance to add a second instance, since a
    // destroyed target has nothing left to shred. destroyChance should equal the plain hit chance.
    const result = computeSequenceOdds([attack({ stat: 20, pow: 0, criticalShred: true })], target);
    expect(result.steps[0].destroyChanceAtThisStep).toBeCloseTo(35 / 36, 9);
  });
});

describe('sequence engine - Rate of Fire', () => {
  function attack(overrides: Partial<SequencedAttack> = {}): SequencedAttack {
    return {
      id: overrides.id ?? 'a',
      attackerName: 'Attacker',
      label: 'Attack',
      type: 'ranged',
      stat: 7,
      pow: 14,
      ...overrides,
    };
  }

  it('rof "1" (or unset) behaves exactly like a single shot', () => {
    const target = { def: 13, arm: 15, boxes: 1000 };
    const withRof1 = computeSequenceOdds([attack({ stat: 6, pow: 12, rof: '1' })], target);
    const withoutRof = computeSequenceOdds([attack({ stat: 6, pow: 12 })], target);
    expect(withRof1.steps[0].averageDamage).toBeCloseTo(withoutRof.steps[0].averageDamage, 9);
    expect(withRof1.steps[0].hitChance).toBeCloseTo(withoutRof.steps[0].hitChance, 9);
  });

  it('ROF d3 multiplies average damage by E[shots]=2 when nothing else changes between shots', () => {
    const target = { def: 2, arm: 0, boxes: 1000 };
    const baseline = computeSequenceOdds([attack({ stat: 20, pow: 0 })], target);
    const withRof = computeSequenceOdds([attack({ stat: 20, pow: 0, rof: 'd3' })], target);
    expect(withRof.steps[0].averageDamage).toBeCloseTo(2 * baseline.steps[0].averageDamage, 9);
  });

  it('ROF 2d3 multiplies average damage by E[shots]=4 when nothing else changes between shots', () => {
    // Sum of two independent d3 rolls: E[2d3] = 2 * E[d3] = 2 * 2 = 4.
    const target = { def: 2, arm: 0, boxes: 1000 };
    const baseline = computeSequenceOdds([attack({ stat: 20, pow: 0 })], target);
    const withRof = computeSequenceOdds([attack({ stat: 20, pow: 0, rof: '2d3' })], target);
    expect(withRof.steps[0].averageDamage).toBeCloseTo(4 * baseline.steps[0].averageDamage, 9);
  });

  it("hit/crit chance stay the FIRST shot's own probability, unaffected by ROF", () => {
    const target = { def: 2, arm: 0, boxes: 1000 };
    const baseline = computeSequenceOdds([attack({ stat: 20, pow: 0 })], target);
    const withRof = computeSequenceOdds([attack({ stat: 20, pow: 0, rof: '2d3' })], target);
    expect(withRof.steps[0].hitChance).toBeCloseTo(baseline.steps[0].hitChance, 9);
    expect(withRof.steps[0].critChance).toBeCloseTo(baseline.steps[0].critChance, 9);
  });

  it('ROF is ignored for non-ranged attacks', () => {
    const target = { def: 2, arm: 0, boxes: 1000 };
    const melee = computeSequenceOdds([attack({ type: 'melee', stat: 20, pow: 0, rof: '2d3' })], target);
    const meleeNoRof = computeSequenceOdds([attack({ type: 'melee', stat: 20, pow: 0 })], target);
    expect(melee.steps[0].averageDamage).toBeCloseTo(meleeNoRof.steps[0].averageDamage, 9);
  });

  it('a lethal hit ends the volley early - destroy chance matches "at least one hit among up to K shots"', () => {
    // Every roll but the forced-miss 1-1 hits, and any hit is lethal against 1 box. Unlike
    // Critical Shred (only continues on a CRIT, a much rarer event), a ROF volley fires every one
    // of its K shots regardless of hit/miss UNLESS the target is already destroyed - so the volley
    // only stops early once a hit actually lands, not merely because one WOULD be lethal. Destroy
    // chance is therefore "at least one hit among up to `count` shots", 1 - missChance^count,
    // averaged over rofOutcomes('2d3') - not simply the single-shot hit chance.
    const target = { def: 2, arm: 0, boxes: 1, furyPoints: 0 };
    const result = computeSequenceOdds([attack({ stat: 20, pow: 0, rof: '2d3' })], target);
    const missChance = 1 / 36;
    const rofDist = [
      { count: 2, probability: 1 / 9 },
      { count: 3, probability: 2 / 9 },
      { count: 4, probability: 3 / 9 },
      { count: 5, probability: 2 / 9 },
      { count: 6, probability: 1 / 9 },
    ];
    const expectedDestroyChance = 1 - rofDist.reduce((sum, { count, probability }) => sum + probability * missChance ** count, 0);
    expect(result.steps[0].destroyChanceAtThisStep).toBeCloseTo(expectedDestroyChance, 9);
  });

  it('probability mass is conserved for a ROF attack: destroy chance + survival distribution sums to 1', () => {
    const target = { def: 13, arm: 15, boxes: 5 };
    const result = computeSequenceOdds([attack({ stat: 8, pow: 14, rof: '2d3' })], target);
    const survivalMass = result.survivalDistribution.reduce((acc, p) => acc + p.probability, 0);
    expect(result.finalDestroyChance + survivalMass).toBeCloseTo(1, 9);
  });

  it('2d3 (more expected shots) destroys the target at least as often as d3', () => {
    const target = { def: 13, arm: 15, boxes: 5 };
    const d3Result = computeSequenceOdds([attack({ stat: 8, pow: 14, rof: 'd3' })], target);
    const twoD3Result = computeSequenceOdds([attack({ stat: 8, pow: 14, rof: '2d3' })], target);
    expect(twoD3Result.finalDestroyChance).toBeGreaterThanOrEqual(d3Result.finalDestroyChance);
  });

  it('a focus point still helps the target survive a ROF volley', () => {
    const withFocus = computeSequenceOdds([attack({ stat: 8, pow: 14, rof: '2d3' })], { def: 13, arm: 15, boxes: 8, focusPoints: 1 });
    const withoutFocus = computeSequenceOdds([attack({ stat: 8, pow: 14, rof: '2d3' })], { def: 13, arm: 15, boxes: 8, focusPoints: 0 });
    expect(withFocus.finalDestroyChance).toBeLessThan(withoutFocus.finalDestroyChance);
  });

  it('a hit-triggered stacking ARM debuff from an earlier shot affects later shots in the SAME volley', () => {
    // Each hit inflicts -5 ARM (cumulative), so a shot later in the volley faces a lower effective
    // ARM than the first - average damage per shot therefore grows across a longer volley, so the
    // whole volley's total should exceed just E[shots] times a single UNPENALIZED shot's damage.
    const target = { def: 2, arm: 10, boxes: 1000 };
    const singleShotBaseline = computeSequenceOdds([attack({ stat: 20, pow: 0 })], target).steps[0].averageDamage;
    const withStack = computeSequenceOdds(
      [attack({ stat: 20, pow: 0, rof: '2d3', statEffects: [{ type: 'armPenalty', trigger: 'hit', amount: 5 }] })],
      target
    );
    expect(withStack.steps[0].averageDamage).toBeGreaterThan(4 * singleShotBaseline);
  });

  it("composes with Critical Shred: each ROF shot can independently trigger its own Shred chain", () => {
    // boxes: 50 (not 1000 like the pure-math ROF/Shred tests above) - realistic upper end of the
    // UI's own 1-99 range (see target-panel.ts's boxesOptions): a full (boxes+1)-wide value-table
    // grid is rebuilt once per ROF shot level AND once per Shred depth within each level, so an
    // unrealistically large box count here multiplies out to several seconds for no benefit this
    // test needs - the assertions below only care about the RELATIVE ordering/equality of the two
    // results, which holds just as well at a realistic box count.
    const target = { def: 2, arm: 0, boxes: 50 };
    const rofOnly = computeSequenceOdds([attack({ stat: 20, pow: 0, rof: 'd3' })], target);
    const rofAndShred = computeSequenceOdds([attack({ stat: 20, pow: 0, rof: 'd3', criticalShred: true })], target);
    expect(rofAndShred.steps[0].averageDamage).toBeGreaterThan(rofOnly.steps[0].averageDamage);
    expect(rofAndShred.steps[0].hitChance).toBeCloseTo(rofOnly.steps[0].hitChance, 9);
  });

  it('runs multiple chained ROF attacks quickly (bounded shot-count branching, no combinatorial blowup)', () => {
    const attacks = Array.from({ length: 5 }, (_, i) => attack({ id: `${i}`, stat: 6 + (i % 3), pow: 12 + (i % 2), rof: '2d3' }));
    const bigTarget = { def: 14, arm: 16, boxes: 20 };

    const start = performance.now();
    const result = computeSequenceOdds(attacks, bigTarget);
    const elapsedMs = performance.now() - start;

    expect(result.steps).toHaveLength(5);
    expect(elapsedMs).toBeLessThan(2000);
  });
});
