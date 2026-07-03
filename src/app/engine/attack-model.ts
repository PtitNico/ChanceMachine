/**
 * attack-model.ts
 * ---------------
 * Composes the low-level dice-pool math into the actual "chance to hit /
 * chance to do damage / chance to destroy the model" numbers a player wants
 * out of an OddsMachine-style calculator.
 *
 * v1 scope (deliberately): a single attack (melee or ranged) against a
 * single target, with boosting, discard, reroll, Tough, and doubles-based
 * criticals. Multi-attack sequences (weapon master extra attacks, RoF,
 * full "assassination run" chains) are a natural v2 built on top of this
 * same module - see the note at the bottom of the file.
 */

import {
  DicePoolOutcome,
  probabilityAtLeast,
  probabilityOfDouble,
  rerollPoolOnceIfBelow,
  rollDicePool,
} from './dice-pool';

export interface RollModifiers {
  /** Extra d6 added to the base 2d6, e.g. from spending a focus/fury point. */
  boostDice?: number;
  /** Discard the N highest or lowest dice before summing (some debuffs/effects). */
  discard?: { count: number; mode: 'highest' | 'lowest' };
  /** Reroll the whole pool once if the raw dice sum is below this value. */
  rerollDiceSumBelow?: number;
}

export interface AttackInput {
  attack: {
    /** MAT for melee, RAT for ranged. */
    stat: number;
    /** Target automatically hit - e.g. target is Knocked Down or Stationary. */
    autoHit?: boolean;
    modifiers?: RollModifiers;
  };
  damage: {
    /** Weapon or spell POW. */
    pow: number;
    modifiers?: RollModifiers;
  };
  target: {
    def: number;
    arm: number;
    /** Remaining damage capacity (health boxes / remaining life) needed to destroy the model. */
    boxesRemaining: number;
    /** Does the target have Tough? */
    tough?: boolean;
    /** Tough roll target number on 1d6 (5 in the core rules: 5 or 6 survives). */
    toughOn?: number;
  };
}

export interface DamagePoint {
  damage: number;
  probability: number;
}

export interface AttackOdds {
  hitChance: number;
  missChance: number;
  /** P(hit AND the attack roll shows a natural double). */
  critOnHitChance: number;
  /** Full damage distribution, INCLUDING the "0 damage" case from a miss. */
  damageDistribution: DamagePoint[];
  expectedDamage: number;
  /** Chance the target is actually removed from play, factoring in a Tough roll if applicable. */
  destroyChance: number;
  /** Convenience: chance of dealing at least N damage (unconditional on hit/miss). */
  chanceOfAtLeast: (n: number) => number;
}

const BASE_DICE = 2; // Warmachine/Hordes attack and damage rolls are 2d6 at baseline.

function buildPool(base: number, mods?: RollModifiers): DicePoolOutcome[] {
  const diceCount = base + (mods?.boostDice ?? 0);
  let pool = rollDicePool({ diceCount, discard: mods?.discard });
  if (mods?.rerollDiceSumBelow !== undefined) {
    pool = rerollPoolOnceIfBelow(pool, mods.rerollDiceSumBelow);
  }
  return pool;
}

export function computeAttackOdds(input: AttackInput): AttackOdds {
  const { attack, damage, target } = input;

  // ---- To-hit ----
  let hitChance: number;
  let critOnHitChance: number;

  if (attack.autoHit) {
    hitChance = 1;
    critOnHitChance = 0; // no attack dice rolled at all -> no doubles to trigger a crit
  } else {
    const toHitPool = buildPool(BASE_DICE, attack.modifiers);
    const neededDiceSum = target.def - attack.stat; // total needed = def, dice needed = def - stat
    hitChance = probabilityAtLeast(toHitPool, neededDiceSum);
    const hitAndDoublePool = toHitPool.filter((o) => o.sum >= neededDiceSum && o.hasDouble);
    critOnHitChance = hitAndDoublePool.reduce((acc, o) => acc + o.probability, 0);
  }
  const missChance = 1 - hitChance;

  // ---- Damage (conditional on a hit) ----
  const dmgPool = buildPool(BASE_DICE, damage.modifiers);
  const dmgByValue = new Map<number, number>(); // damage dealt (post-ARM, floored at 0) -> prob within a hit

  for (const outcome of dmgPool) {
    const raw = outcome.sum + damage.pow - target.arm;
    const dealt = Math.max(0, raw);
    dmgByValue.set(dealt, (dmgByValue.get(dealt) ?? 0) + outcome.probability);
  }

  // ---- Combine hit/miss into one unconditional damage distribution ----
  const combined = new Map<number, number>();
  combined.set(0, missChance); // miss => 0 damage
  for (const [dealt, prob] of dmgByValue) {
    combined.set(dealt, (combined.get(dealt) ?? 0) + prob * hitChance);
  }

  const damageDistribution: DamagePoint[] = [...combined.entries()]
    .map(([dmg, probability]) => ({ damage: dmg, probability }))
    .sort((a, b) => a.damage - b.damage);

  const expectedDamage = damageDistribution.reduce((acc, p) => acc + p.damage * p.probability, 0);

  // ---- Destroy chance, factoring in Tough ----
  const lethalChance = damageDistribution
    .filter((p) => p.damage >= target.boxesRemaining)
    .reduce((acc, p) => acc + p.probability, 0);

  let destroyChance = lethalChance;
  if (target.tough) {
    const toughOn = target.toughOn ?? 5;
    const failToughChance = (toughOn - 1) / 6; // e.g. 5+ survives => fails on 1-4 => 4/6
    destroyChance = lethalChance * failToughChance;
  }

  const chanceOfAtLeast = (n: number) =>
    damageDistribution.filter((p) => p.damage >= n).reduce((acc, p) => acc + p.probability, 0);

  return {
    hitChance,
    missChance,
    critOnHitChance,
    damageDistribution,
    expectedDamage,
    destroyChance,
    chanceOfAtLeast,
  };
}

/**
 * v2 idea (not implemented here): a full "assassination run" is just a
 * sequence of AttackInputs applied to a shrinking `boxesRemaining`. You can
 * build that by branching on each attack's damageDistribution (a small
 * probability tree - still exact enumeration, just nested) rather than
 * simulating. Ping me when you're ready for that piece; it reuses
 * everything above.
 */
