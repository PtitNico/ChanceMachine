import { describe, expect, it } from 'vitest';
import { probabilityAtLeast, probabilityOfDouble, rollDicePool } from './dice-pool';
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
      criticalEffects: { brutalDamageDice: 2 },
      target: { def: 7, arm: 0, boxesRemaining: 1000 },
    });

    expect(withBrutal.hitChance).toBeCloseTo(withoutBrutal.hitChance, 9); // to-hit is unaffected
    expect(withBrutal.expectedDamage).toBeGreaterThan(withoutBrutal.expectedDamage);
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
    // Attack 1 keeps a normal, realistic chance to hit/crit (DEF 13). Attack 2
    // has an absurdly low stat so it could basically never hit on its own -
    // the only way it can hit is if Knockdown from attack 1's crit carries over.
    const attacks: SequencedAttack[] = [
      attack({ id: '1', criticalEffects: { knockdown: true } }),
      attack({ id: '2', type: 'melee', stat: -50 }),
    ];
    const result = computeSequenceOdds(attacks, target);
    expect(result.steps[1].hitChance).toBeGreaterThan(0);
  });

  it('Knockdown does not grant a ranged attack an auto-hit against the same target', () => {
    const attacks: SequencedAttack[] = [
      attack({ id: '1', criticalEffects: { knockdown: true } }),
      attack({ id: '2', type: 'ranged', stat: -50 }),
    ];
    const result = computeSequenceOdds(attacks, target);
    expect(result.steps[1].hitChance).toBeCloseTo(0, 6);
  });

  it('attack order matters: a high-crit-chance Knockdown attack helps more when it goes first', () => {
    const knockdownFirst: SequencedAttack[] = [
      attack({ id: '1', criticalEffects: { knockdown: true } }),
      attack({ id: '2', stat: 1 }), // weak attack that badly needs the auto-hit assist
    ];
    const knockdownSecond: SequencedAttack[] = [
      attack({ id: '1', stat: 1 }),
      attack({ id: '2', criticalEffects: { knockdown: true } }),
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
    const lethalAttack = attack({ type: 'melee', stat: 6, pow: 1, criticalEffects: undefined, forceAutoHit: true });
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
      attack({ id: '2', type: 'ranged', pow: 10, criticalEffects: { knockdown: true } }),
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

  it("DEF: 'KD' also makes ranged and arcane attacks auto-hit (unlike a mid-sequence Knockdown crit)", () => {
    const ranged = computeSequenceOdds([attack({ type: 'ranged', stat: -50 })], { def: 'KD', arm: 15, boxes: 5 });
    const arcane = computeSequenceOdds([attack({ type: 'arcane', stat: -50 })], { def: 'KD', arm: 15, boxes: 5 });
    expect(ranged.steps[0].hitChance).toBeCloseTo(1, 9);
    expect(arcane.steps[0].hitChance).toBeCloseTo(1, 9);
  });

  it("an auto-hit from DEF: 'KD' cannot crit (no attack roll is made)", () => {
    const result = computeSequenceOdds(
      [attack({ stat: -50, criticalEffects: { brutalDamageDice: 2 } })],
      { def: 'KD', arm: 0, boxes: 1000 }
    );
    // If it could crit, Brutal Damage would push expected damage up; confirm it behaves
    // identically to the same attack without Brutal Damage (i.e. the crit branch is unreachable).
    const withoutBrutal = computeSequenceOdds([attack({ stat: -50 })], { def: 'KD', arm: 0, boxes: 1000 });
    expect(result.steps[0].expectedBoxesRemaining).toBeCloseTo(withoutBrutal.steps[0].expectedBoxesRemaining, 9);
  });
});
