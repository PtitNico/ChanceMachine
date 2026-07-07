/**
 * attack-model.ts
 * ---------------
 * Composes the low-level dice-pool math into the actual "chance to hit /
 * chance to do damage / chance to destroy the model" numbers a player wants
 * out of an OddsMachine-style calculator, for ONE attack against ONE target.
 *
 * The expensive part (enumerating every dice-pool outcome) is isolated in
 * `buildAttackProfile`, which deliberately does NOT depend on the target's
 * remaining boxes. That split lets `sequence.ts` build each attack's profile
 * exactly once and then cheaply re-apply it against many different
 * boxes-remaining values as a multi-attack sequence plays out, instead of
 * re-enumerating dice per step.
 */

import {
  DicePoolOutcome,
  rerollPoolOnceIfBelow,
  rollDicePool,
} from './dice-pool';

export type AttackType = 'melee' | 'ranged' | 'arcane';

export interface RollModifiers {
  /** Extra d6 added to the base 2d6, e.g. from spending a focus/fury point. */
  boostDice?: number;
  /** Discard the N highest or lowest dice before summing (some debuffs/effects). */
  discard?: { count: number; mode: 'highest' | 'lowest' };
  /** Reroll the whole pool once if the raw dice sum is below this value. */
  rerollDiceSumBelow?: number;
}

/**
 * Effects that trigger only on a critical hit (a natural double on the
 * attack roll). Kept deliberately small for now - a curated, exact list
 * beats a vague generic system. More named effects (Decapitation, Sustained
 * Attack, etc.) will be added once their exact rules text is confirmed.
 */
export interface CriticalEffects {
  /** Target becomes Knocked Down for the rest of the sequence. Only melee
   *  attacks auto-hit a Knocked Down target (see `AttackInput.target.knockedDown`). */
  knockdown?: boolean;
  /** Extra d6 added to the damage roll, but only on the crit branch (e.g. Brutal Damage). */
  brutalDamageDice?: number;
}

export interface AttackInput {
  attack: {
    type: AttackType;
    /** MAT for melee, RAT for ranged, RAT/spell stat for arcane. */
    stat: number;
    /** Manual override: attack automatically hits regardless of DEF (e.g. target is Stationary). */
    autoHit?: boolean;
    modifiers?: RollModifiers;
  };
  damage: {
    /** Weapon or spell POW. */
    pow: number;
    modifiers?: RollModifiers;
  };
  criticalEffects?: CriticalEffects;
  target: {
    def: number;
    arm: number;
    /** Remaining damage capacity (health boxes / remaining life) needed to destroy the model. */
    boxesRemaining: number;
    /** Does the target have Tough? */
    tough?: boolean;
    /** Tough roll target number on 1d6 (5 in the core rules: 5 or 6 survives). */
    toughOn?: number;
    /** Target is already Knocked Down when this attack resolves. Melee attacks
     *  automatically hit a Knocked Down target; ranged/arcane attacks are unaffected. */
    knockedDown?: boolean;
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

function buildPool(base: number, mods?: RollModifiers, extraDice = 0): DicePoolOutcome[] {
  const diceCount = base + (mods?.boostDice ?? 0) + extraDice;
  let pool = rollDicePool({ diceCount, discard: mods?.discard });
  if (mods?.rerollDiceSumBelow !== undefined) {
    pool = rerollPoolOnceIfBelow(pool, mods.rerollDiceSumBelow);
  }
  return pool;
}

/** Number of dice actually counted towards the sum, after any discard. */
function keptDiceCount(base: number, mods?: RollModifiers, extraDice = 0): number {
  return base + (mods?.boostDice ?? 0) + extraDice - (mods?.discard?.count ?? 0);
}

/**
 * A roll where every kept die shows the same extreme face is a hard override
 * of the normal MAT/RAT/AAT-vs-DEF comparison: all 1s always misses, and all
 * 6s always hits (unless only one die is being rolled, in which case a lone
 * 6 is just a 6, not the "natural roll of doubles/triples of 6" this models).
 * Since dice faces are always >= 1, the sum of N dice equals N only when
 * every die shows exactly 1, and equals 6N only when every die shows 6 - so
 * this is fully determined by the pool's `sum` and dice count, no need to
 * inspect individual faces.
 */
function isHitOutcome(outcome: DicePoolOutcome, neededDiceSum: number, diceCount: number): boolean {
  if (outcome.sum === diceCount) return false;
  if (diceCount > 1 && outcome.sum === diceCount * 6) return true;
  return outcome.sum >= neededDiceSum;
}

function damageDistFromPool(pool: DicePoolOutcome[], pow: number, arm: number): Map<number, number> {
  const dist = new Map<number, number>();
  for (const outcome of pool) {
    const dealt = Math.max(0, outcome.sum + pow - arm);
    dist.set(dealt, (dist.get(dealt) ?? 0) + outcome.probability);
  }
  return dist;
}

/**
 * An attack's full probabilistic profile, independent of the target's
 * remaining boxes. This is the piece that enumerates dice pools, so it's
 * built once per attack and reused across every target state a sequence
 * needs to consider.
 */
export interface AttackProfile {
  missChance: number;
  hitNonCritChance: number;
  hitCritChance: number;
  /** Damage dealt (post-ARM) -> probability, conditional on a non-crit hit. */
  nonCritDamage: Map<number, number>;
  /** Damage dealt (post-ARM) -> probability, conditional on a crit hit (includes Brutal Damage dice, if any). */
  critDamage: Map<number, number>;
}

export function buildAttackProfile(
  attack: AttackInput['attack'],
  damage: AttackInput['damage'],
  target: Pick<AttackInput['target'], 'def' | 'arm'>,
  criticalEffects: CriticalEffects | undefined,
  autoHit: boolean
): AttackProfile {
  const baseDamagePool = buildPool(BASE_DICE, damage.modifiers);
  const nonCritDamage = damageDistFromPool(baseDamagePool, damage.pow, target.arm);

  if (autoHit) {
    // No attack roll is made at all, so no doubles are rolled - an auto-hit
    // (Stationary/Knocked Down target) can never be a critical hit.
    return { missChance: 0, hitNonCritChance: 1, hitCritChance: 0, nonCritDamage, critDamage: new Map() };
  }

  const toHitPool = buildPool(BASE_DICE, attack.modifiers);
  const neededDiceSum = target.def - attack.stat; // total needed = def, dice needed = def - stat
  const toHitDiceCount = keptDiceCount(BASE_DICE, attack.modifiers);
  const hitOutcomes = toHitPool.filter((o) => isHitOutcome(o, neededDiceSum, toHitDiceCount));
  const hitChance = hitOutcomes.reduce((acc, o) => acc + o.probability, 0);
  const hitCritChance = hitOutcomes.filter((o) => o.hasDouble).reduce((acc, o) => acc + o.probability, 0);
  const hitNonCritChance = hitChance - hitCritChance;
  const missChance = 1 - hitChance;

  const brutalDice = criticalEffects?.brutalDamageDice ?? 0;
  const critDamage =
    brutalDice > 0
      ? damageDistFromPool(buildPool(BASE_DICE, damage.modifiers, brutalDice), damage.pow, target.arm)
      : nonCritDamage;

  return { missChance, hitNonCritChance, hitCritChance, nonCritDamage, critDamage };
}

export interface AppliedOutcome {
  /** Unconditional probability of this exact outcome (all outcomes for one attack sum to 1). */
  probability: number;
  isHit: boolean;
  isCrit: boolean;
  damageDealt: number;
}

/** Expands a profile into the flat list of (probability, hit/crit, damage) outcomes. */
export function applyProfile(profile: AttackProfile): AppliedOutcome[] {
  const outcomes: AppliedOutcome[] = [];
  if (profile.missChance > 0) {
    outcomes.push({ probability: profile.missChance, isHit: false, isCrit: false, damageDealt: 0 });
  }
  if (profile.hitNonCritChance > 0) {
    for (const [damageDealt, p] of profile.nonCritDamage) {
      outcomes.push({ probability: profile.hitNonCritChance * p, isHit: true, isCrit: false, damageDealt });
    }
  }
  if (profile.hitCritChance > 0) {
    for (const [damageDealt, p] of profile.critDamage) {
      outcomes.push({ probability: profile.hitCritChance * p, isHit: true, isCrit: true, damageDealt });
    }
  }
  return outcomes;
}

export function computeAttackOdds(input: AttackInput): AttackOdds {
  const { attack, damage, target, criticalEffects } = input;
  const autoHit = !!attack.autoHit || (!!target.knockedDown && attack.type === 'melee');
  const profile = buildAttackProfile(attack, damage, target, criticalEffects, autoHit);
  const outcomes = applyProfile(profile);

  const hitChance = profile.hitNonCritChance + profile.hitCritChance;
  const missChance = profile.missChance;
  const critOnHitChance = profile.hitCritChance;

  const combined = new Map<number, number>();
  for (const o of outcomes) {
    combined.set(o.damageDealt, (combined.get(o.damageDealt) ?? 0) + o.probability);
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
