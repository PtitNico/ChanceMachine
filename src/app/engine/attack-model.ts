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
 * exactly once per distinct (DEF/ARM/status) context and reuse it cheaply
 * across every target state a sequence needs to consider, instead of
 * re-enumerating dice per step.
 *
 * This module only knows about effects that matter for ONE attack in
 * isolation (Brutal Damage, Armor Piercing, Decapitation, Trash, Shatter -
 * all resolved using the target's CURRENT DEF/ARM/status, passed in as plain
 * numbers/flags). Effects that persist and change the target's DEF/ARM/status
 * for LATER attacks in a sequence (Knockdown, Stationary, Ice Cage,
 * Shadowbind, Blind, Paralysis, Flare, Weaken, generic ARM debuffs) are
 * `sequence.ts`'s job - it computes the effective DEF/ARM for a given point
 * in the sequence and passes plain numbers in here.
 */

import {
  DicePoolOutcome,
  rerollPoolOnceIf,
  rollDicePool,
} from './dice-pool';

export type AttackType = 'melee' | 'ranged' | 'arcane';

/** Whether a one-off effect triggers on any hit, or only on a critical hit. */
export type EffectTrigger = 'hit' | 'crit';

export interface RollModifiers {
  /** Extra d6 added to the base 2d6, e.g. from spending a focus/fury point. */
  boostDice?: number;
  /** Discard the N highest and/or M lowest dice before summing - both can be set at once. */
  discard?: { highest?: number; lowest?: number };
  /** Reroll the whole roll once if it's "bad" (optimal single-reroll policy): for
   *  an attack roll, bad means it would miss; for a damage roll, bad means
   *  below-average. See `applyRerollIfConfigured`. */
  reroll?: boolean;
  /** Jump the Shark: every rolled die showing a 1 counts as a 6 instead. */
  treatOnesAsSixes?: boolean;
  /** Sanguine Fate: N extra d6 that count towards "double" detection for a
   *  crit, without being added to the roll's sum. Only meaningful on an
   *  attack roll (there's no such thing as a "critical" damage roll). */
  extraCritDice?: number;
}

/**
 * Effects scoped to THIS single attack (as opposed to persistent target
 * debuffs - see the file header). Kept as a curated, exact list rather than
 * a vague generic system.
 */
export interface AttackEffects {
  /** Crit-only: extra d6 added to the damage roll (Brutal Damage). */
  brutalDamageDice?: number;
  /** Halves BASE ARM (rounded up), for this attack's damage only - every buff/debuff currently
   *  in play (Shield, spell bonuses, Unyielding/Carapace, persistent ARM penalties) still applies
   *  on top of the halved value, exactly as it would without Armor Piercing. */
  armorPiercing?: EffectTrigger;
  /** Doubles this attack's damage. */
  decapitation?: EffectTrigger;
  /** Extra d6 on the damage roll if the target is currently Knocked Down (Trash). */
  trash?: boolean;
  /** Extra d6 on the damage roll if the target is currently Stationary (Shatter). */
  shatter?: boolean;
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
  effects?: AttackEffects;
  target: {
    def: number;
    /** Effective ARM, after every buff/debuff/penalty currently in play. */
    arm: number;
    /** Printed base ARM, before any buff/debuff/penalty - the value Armor Piercing halves
     *  (`arm - baseArm`, the net buff/debuff total, is then added back on top - see
     *  `buildAttackProfile`). Defaults to `arm` (i.e. nothing in play) when omitted. */
    baseArm?: number;
    /** Remaining damage capacity (health boxes / remaining life) needed to destroy the model. */
    boxesRemaining: number;
    /** Does the target have Tough? */
    tough?: boolean;
    /** Tough roll target number on 1d6 (5 in the core rules: 5 or 6 survives). */
    toughOn?: number;
    /** Target is already Knocked Down when this attack resolves. Melee attacks
     *  automatically hit a Knocked Down (or Stationary) target; ranged/arcane are unaffected. */
    knockedDown?: boolean;
    /** Target is already Stationary when this attack resolves. Functionally identical
     *  to Knocked Down for the to-hit roll (melee auto-hits, ranged/arcane unaffected) -
     *  tracked separately only because Shatter cares about Stationary specifically. */
    stationary?: boolean;
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
  return rollDicePool({
    diceCount,
    discard: mods?.discard,
    treatOnesAsSixes: mods?.treatOnesAsSixes,
    extraCritDice: mods?.extraCritDice,
  });
}

/** Number of dice actually counted towards the sum, after any discard (excludes Sanguine Fate's extra crit dice). */
function keptDiceCount(base: number, mods?: RollModifiers, extraDice = 0): number {
  const discarded = (mods?.discard?.highest ?? 0) + (mods?.discard?.lowest ?? 0);
  return Math.max(0, base + (mods?.boostDice ?? 0) + extraDice - discarded);
}

/** A below-average raw dice sum is always worth rerolling (strictly maximizes expected damage) -
 *  the row's own Reroll toggle already uses this; Puppet Master's own below-average check (see
 *  `splitAttackDamageForPuppetMaster`) uses the exact same criterion, on whatever's actually being
 *  rolled (after the row's own Reroll, if any, has already been applied). */
export function isBadDamageRoll(outcome: DicePoolOutcome, diceCount: number): boolean {
  return outcome.sum < 3.5 * diceCount;
}

function applyRerollIfConfigured(
  pool: DicePoolOutcome[],
  mods: RollModifiers | undefined,
  isBad: (outcome: DicePoolOutcome) => boolean
): DicePoolOutcome[] {
  return mods?.reroll ? rerollPoolOnceIf(pool, isBad) : pool;
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

export function damageDistFromPool(pool: DicePoolOutcome[], pow: number, arm: number): Map<number, number> {
  const dist = new Map<number, number>();
  for (const outcome of pool) {
    const dealt = Math.max(0, outcome.sum + pow - arm);
    dist.set(dealt, (dist.get(dealt) ?? 0) + outcome.probability);
  }
  return dist;
}

function doubleDamageValues(dist: Map<number, number>): Map<number, number> {
  const doubled = new Map<number, number>();
  for (const [dealt, p] of dist) {
    doubled.set(dealt * 2, (doubled.get(dealt * 2) ?? 0) + p);
  }
  return doubled;
}

/** Whether a one-off effect (Armor Piercing / Decapitation) applies to a non-crit hit. */
function appliesOnNonCritHit(trigger: EffectTrigger | undefined): boolean {
  return trigger === 'hit';
}

/** Whether it applies to a crit - both triggers do, since a crit is also a hit. */
function appliesOnCritHit(trigger: EffectTrigger | undefined): boolean {
  return trigger === 'hit' || trigger === 'crit';
}

/** Armor Piercing halves only the printed base ARM - every buff/debuff currently in play
 *  (Shield, spell bonuses, Unyielding/Carapace, persistent ARM penalties like Ice Cage's) still
 *  applies on top, same as normal. `target.arm - baseArm` is that net modifier total, since
 *  `target.arm` is already the fully-resolved ARM (base + every modifier folded in). */
function resolveArm(effects: AttackEffects | undefined, target: { arm: number; baseArm?: number }, variant: 'nonCrit' | 'crit'): number {
  const baseArm = target.baseArm ?? target.arm;
  const armorPiercingArm = Math.ceil(baseArm / 2) + (target.arm - baseArm);
  const applies = variant === 'nonCrit' ? appliesOnNonCritHit(effects?.armorPiercing) : appliesOnCritHit(effects?.armorPiercing);
  return applies ? armorPiercingArm : target.arm;
}

/** The dice pool actually being rolled for this attack's damage (Trash/Shatter's conditional
 *  extra die already folded in, and the row's own Reroll toggle already applied if configured) -
 *  shared by `buildAttackProfile` and by Puppet Master's own below-average check
 *  (`splitAttackDamageForPuppetMaster` in sequence.ts's Puppet Master section) so neither
 *  duplicates the other's resolution of extra dice/reroll. `extraDice` is ONLY Brutal Damage's
 *  dice (0 for a non-crit roll) - Trash/Shatter are resolved internally from `effects`/`target`. */
export function damagePoolFor(
  damage: AttackInput['damage'],
  effects: AttackEffects | undefined,
  target: Pick<AttackInput['target'], 'knockedDown' | 'stationary'>,
  extraDice: number
): { pool: DicePoolOutcome[]; diceCount: number } {
  const conditionalExtraDice = (effects?.trash && target.knockedDown ? 1 : 0) + (effects?.shatter && target.stationary ? 1 : 0);
  const totalExtra = extraDice + conditionalExtraDice;
  const pool = buildPool(BASE_DICE, damage.modifiers, totalExtra);
  const diceCount = keptDiceCount(BASE_DICE, damage.modifiers, totalExtra);
  return { pool: applyRerollIfConfigured(pool, damage.modifiers, (o) => isBadDamageRoll(o, diceCount)), diceCount };
}

/**
 * An attack's full probabilistic profile, independent of the target's
 * remaining boxes. This is the piece that enumerates dice pools, so it's
 * built once per attack (per distinct DEF/ARM/status context) and reused
 * across every target state a sequence needs to consider.
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
  target: Pick<AttackInput['target'], 'def' | 'arm' | 'baseArm' | 'knockedDown' | 'stationary'>,
  effects: AttackEffects | undefined,
  autoHit: boolean
): AttackProfile {
  const nonCritArm = resolveArm(effects, target, 'nonCrit');
  const critArm = resolveArm(effects, target, 'crit');

  let nonCritDamage = damageDistFromPool(damagePoolFor(damage, effects, target, 0).pool, damage.pow, nonCritArm);
  if (appliesOnNonCritHit(effects?.decapitation)) nonCritDamage = doubleDamageValues(nonCritDamage);

  if (autoHit) {
    // No attack roll is made at all, so no doubles are rolled - an auto-hit
    // (Stationary/Knocked Down target) can never be a critical hit.
    return { missChance: 0, hitNonCritChance: 1, hitCritChance: 0, nonCritDamage, critDamage: new Map() };
  }

  const neededDiceSum = target.def - attack.stat; // total needed = def, dice needed = def - stat
  const toHitDiceCount = keptDiceCount(BASE_DICE, attack.modifiers);
  const toHitPool = applyRerollIfConfigured(
    buildPool(BASE_DICE, attack.modifiers),
    attack.modifiers,
    (o) => !isHitOutcome(o, neededDiceSum, toHitDiceCount)
  );
  const hitOutcomes = toHitPool.filter((o) => isHitOutcome(o, neededDiceSum, toHitDiceCount));
  const hitChance = hitOutcomes.reduce((acc, o) => acc + o.probability, 0);
  const hitCritChance = hitOutcomes.filter((o) => o.hasDouble).reduce((acc, o) => acc + o.probability, 0);
  const hitNonCritChance = hitChance - hitCritChance;
  const missChance = 1 - hitChance;

  const brutalDice = effects?.brutalDamageDice ?? 0;
  let critDamage: Map<number, number>;
  if (brutalDice > 0) {
    critDamage = damageDistFromPool(damagePoolFor(damage, effects, target, brutalDice).pool, damage.pow, critArm);
  } else if (critArm === nonCritArm) {
    critDamage = nonCritDamage; // same dice, same ARM -> identical distribution, reuse it
  } else {
    critDamage = damageDistFromPool(damagePoolFor(damage, effects, target, 0).pool, damage.pow, critArm);
  }
  if (appliesOnCritHit(effects?.decapitation)) critDamage = doubleDamageValues(critDamage);

  return { missChance, hitNonCritChance, hitCritChance, nonCritDamage, critDamage };
}

/** Which direction of "away from average" a reroll-granting rule cares about: Puppet Master and
 *  Offensive Knowledge of the Damned both want to catch a BAD (below-average) roll for the
 *  attacker's own benefit; Defensive Knowledge of the Damned wants the mirror image - catching a
 *  GOOD (above-average) roll, for the target's benefit. Both share the exact same strict-inequality
 *  split logic below, just flipped - see `splitAttackDamageByAverage`. */
export type DamageRerollDirection = 'rerollBelowAverage' | 'rerollAboveAverage';

export interface DamageAverageSplit {
  /** This damage roll's distribution conditional on NOT being rerolled by this direction's rule
   *  (identical to the corresponding slice of `AttackProfile`'s own map). */
  kept: Map<number, number>;
  /** Probability mass this direction's rule would reroll (see `isBadDamageRoll`, or its flipped
   *  counterpart for the 'rerollAboveAverage' direction) - the reroll's own result is drawn fresh
   *  from the SAME pool (an i.i.d. redraw), which is mathematically identical to the corresponding
   *  FULL, unconditional `AttackProfile` map again - see sequence.ts's Knowledge of the Damned
   *  section for why that means the caller doesn't need this function to also return a "rerolled"
   *  distribution. */
  rerollMass: number;
}

/** Splits a damage roll (non-crit or crit) by whether its own dice sum falls on the side of average
 *  that `direction` cares about - the same criterion the row's own Reroll toggle already uses for
 *  the below-average direction - so Puppet Master/Knowledge of the Damned (sequence.ts) can tell
 *  whether their own reroll rule would trigger, without duplicating Trash/Shatter/Armor
 *  Piercing/Brutal Damage/Decapitation's resolution here. Mirrors `buildAttackProfile`'s own
 *  nonCritDamage/critDamage derivation exactly, just reporting the split instead of one blended map. */
export function splitAttackDamageByAverage(
  damage: AttackInput['damage'],
  effects: AttackEffects | undefined,
  target: Pick<AttackInput['target'], 'arm' | 'baseArm' | 'knockedDown' | 'stationary'>,
  variant: 'nonCrit' | 'crit',
  direction: DamageRerollDirection
): DamageAverageSplit {
  const arm = resolveArm(effects, target, variant);
  const extraDice = variant === 'crit' ? (effects?.brutalDamageDice ?? 0) : 0;
  const { pool, diceCount } = damagePoolFor(damage, effects, target, extraDice);
  const rerolls = (o: DicePoolOutcome) => (direction === 'rerollBelowAverage' ? isBadDamageRoll(o, diceCount) : o.sum > 3.5 * diceCount);
  const rerollMass = pool.reduce((acc, o) => (rerolls(o) ? acc + o.probability : acc), 0);
  let kept = damageDistFromPool(
    pool.filter((o) => !rerolls(o)),
    damage.pow,
    arm
  );
  const doubles = variant === 'nonCrit' ? appliesOnNonCritHit(effects?.decapitation) : appliesOnCritHit(effects?.decapitation);
  if (doubles) kept = doubleDamageValues(kept);
  return { kept, rerollMass };
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
  const { attack, damage, target, effects } = input;
  const autoHit = !!attack.autoHit || ((!!target.knockedDown || !!target.stationary) && attack.type === 'melee');
  const profile = buildAttackProfile(attack, damage, target, effects, autoHit);
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
