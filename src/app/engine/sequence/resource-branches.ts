import { AttackProfile } from '../attack-model';
import { FOCUS_DAMAGE_REDUCTION } from './constants';
import { DebuffState, isKnockedDownOrStationary } from './debuff-state';

// --- Resource (boxes / Focus / Fury) branching, independent of WHICH debuff state we're in ---

export interface ResourceBranch {
  probability: number;
  boxes: number;
  debuffState: DebuffState;
  focusLeft: number;
  furyLeft: number;
  /** Remaining Shield Guards/Scapegoats - see `bestAction`'s doc comment. Pure pass-through on
   *  every branch except the two block candidates, which decrement their own counter. */
  shieldGuardsLeft: number;
  scapegoatsLeft: number;
  destroyed: boolean;
}

export type ValueLookup = (
  boxes: number,
  debuffState: DebuffState,
  focusLeft: number,
  furyLeft: number,
  shieldGuardsLeft: number,
  scapegoatsLeft: number
) => number;

/** Like `ValueLookup`, but aware of every FIXED-rule/optimal-choice resource dimension that lives
 *  ABOVE `bestAction`'s own level (`attackChainValue`/`buildShotsValue`/the forward-pass
 *  equivalents) - Puppet Master's `pmMask`, Offensive Knowledge of the Damned's `kotdOffLeft`, and
 *  Defensive Knowledge of the Damned's `kotdDefLeft`. All three only ever change once, atomically,
 *  before a roll's outcome is even enumerated - see the module doc comment's Knowledge of the
 *  Damned section. `sustained` (Sustained Attack/Critical Sustained Attack - see the module doc
 *  comment's own section) rides the same mechanism, but - unlike the other three - resets to
 *  `false` at the start of every row's own shot loop rather than persisting sequence-wide. */
export type ExtendedValueLookup = (
  boxes: number,
  debuffState: DebuffState,
  focusLeft: number,
  furyLeft: number,
  shieldGuardsLeft: number,
  scapegoatsLeft: number,
  pmMask: number,
  kotdOffLeft: number,
  kotdDefLeft: number,
  attackerFocusLeft: number[],
  sustained: boolean
) => number;

/** One genuinely-occurring sub-population arising from Puppet Master's fixed rule at THIS roll -
 *  see `resolvePmSplit`. Unlike Focus/Fury's `bestAction`, this is never a competing CHOICE between
 *  alternatives: every population a call returns actually happens, in a different slice of the
 *  roll, each already scaled to its own share of the mass entering this roll. */
export interface PmPopulation {
  profile: AttackProfile;
  /** `pmMask` as it reads for this population - unchanged unless the token was spent here. */
  resultingMask: number;
}

/**
 * Tough/Tough Steady come in a pre-Dispel/post-Dispel pair (see `SequenceTarget`'s
 * `toughPostDispel`/`toughSteadyPostDispel` doc comment) since either can be spell-granted and
 * therefore removable by Dispel. Bundled into one object so `damageBranches`/`bestAction` don't
 * need five separate positional booleans/numbers threaded through every call.
 */
export interface ToughRules {
  hasTough: boolean;
  hasToughSteady: boolean;
  hasToughPostDispel: boolean;
  hasToughSteadyPostDispel: boolean;
  failChance: number;
}

/** Rapid Healing is a target-level capability like Tough, rather than something Dispel can strip -
 *  Grievous Wounds is what turns it off instead (`DebuffState.grievouslyWounded`), so there's no
 *  pre/post-Dispel pair to bundle here the way `ToughRules` needs. */
export interface HealingRules {
  hasRapidHealing: boolean;
  /** Caps how high a heal roll can bring the target back - never above its starting box count. */
  initialBoxes: number;
}

/**
 * Splits a single non-destroyed outcome into its Rapid Healing sub-outcomes (a d3 roll, each face
 * equally likely) if the target is eligible - has Rapid Healing, isn't currently Grievously
 * Wounded, and this attack actually dealt damage - otherwise returns the outcome unchanged.
 * `boxes` is the box count AFTER damage/Tough have already been resolved, before any healing.
 * Eligibility is checked against `rawDamageDealt` (the attack's damage BEFORE any Focus/Fury
 * mitigation), not the amount that actually came off `boxes`: a target that spends a resource
 * point to blunt or fully negate a hit still took that hit - it was "damaged by the attack" the
 * moment it landed, Focus/Fury just softened the consequence, so Rapid Healing still triggers off
 * the original wound. Only a genuine miss (`rawDamageDealt === 0`) skips healing entirely.
 */
function healBranches(
  boxes: number,
  rawDamageDealt: number,
  debuffState: DebuffState,
  focusLeft: number,
  furyLeft: number,
  shieldGuardsLeft: number,
  scapegoatsLeft: number,
  healing: HealingRules
): ResourceBranch[] {
  if (!healing.hasRapidHealing || rawDamageDealt <= 0 || debuffState.grievouslyWounded) {
    return [{ probability: 1, boxes, debuffState, focusLeft, furyLeft, shieldGuardsLeft, scapegoatsLeft, destroyed: false }];
  }
  return [1, 2, 3].map((healAmount) => ({
    probability: 1 / 3,
    boxes: Math.min(healing.initialBoxes, boxes + healAmount),
    debuffState,
    focusLeft,
    furyLeft,
    shieldGuardsLeft,
    scapegoatsLeft,
    destroyed: false,
  }));
}

/** Applies a (possibly already-mitigated) damage value against the target's boxes, bifurcating on
 *  a Tough roll if lethal, then folding in Rapid Healing (see `healBranches`) on every surviving
 *  outcome. `damageDealt` is what actually comes off `boxes` (post-Focus/Fury); `rawDamageDealt`
 *  is what the attack dealt before any such mitigation, and is only used to gate Rapid Healing -
 *  see `healBranches`'s doc comment for why the two must be kept separate. */
function damageBranches(
  boxes: number,
  damageDealt: number,
  rawDamageDealt: number,
  debuffState: DebuffState,
  focusLeft: number,
  furyLeft: number,
  shieldGuardsLeft: number,
  scapegoatsLeft: number,
  tough: ToughRules,
  healing: HealingRules
): ResourceBranch[] {
  const lethal = damageDealt >= boxes;
  if (!lethal) {
    return healBranches(boxes - damageDealt, rawDamageDealt, debuffState, focusLeft, furyLeft, shieldGuardsLeft, scapegoatsLeft, healing);
  }
  // Once Dispel has fired, a spell-granted Tough/Tough Steady is gone - fall back to whichever
  // half of the pair matches the target's current (innate-only, once dispelled) toughness.
  const hasTough = debuffState.dispelled ? tough.hasToughPostDispel : tough.hasTough;
  const hasToughSteady = debuffState.dispelled ? tough.hasToughSteadyPostDispel : tough.hasToughSteady;
  // Plain Tough can't be attempted while Knocked Down/Stationary (the real tabletop rule); Tough
  // Steady is immune to that negation - that's the entire difference between the two abilities.
  // Grievous Wounds removes both outright, on top of (and regardless of) that negation.
  const toughApplies =
    !debuffState.grievouslyWounded && (hasToughSteady || (hasTough && !isKnockedDownOrStationary(debuffState)));
  if (!toughApplies) {
    return [{ probability: 1, boxes: 0, debuffState, focusLeft, furyLeft, shieldGuardsLeft, scapegoatsLeft, destroyed: true }];
  }
  // Tough simplification (see attack-model.ts): survives on 1 box and Knocked Down.
  const survivedState = debuffState.knockedDown ? debuffState : { ...debuffState, knockedDown: true };
  const survivedBranches = healBranches(1, rawDamageDealt, survivedState, focusLeft, furyLeft, shieldGuardsLeft, scapegoatsLeft, healing).map((b) => ({
    ...b,
    probability: b.probability * (1 - tough.failChance),
  }));
  return [
    ...survivedBranches,
    { probability: tough.failChance, boxes: 0, debuffState, focusLeft, furyLeft, shieldGuardsLeft, scapegoatsLeft, destroyed: true },
  ];
}

export function branchesValue(branches: ResourceBranch[], valueAt: ValueLookup): number {
  return branches.reduce(
    (acc, b) =>
      acc + b.probability * (b.destroyed ? 0 : valueAt(b.boxes, b.debuffState, b.focusLeft, b.furyLeft, b.shieldGuardsLeft, b.scapegoatsLeft)),
    0
  );
}

/**
 * A lexicographic score for choosing between actions: (1) probability of
 * surviving the rest of the sequence - the real objective; (2) probability
 * of surviving THIS hit; (3) expected boxes preserved by this hit. (2) and
 * (3) only ever act as tie-breakers for (1). Without them, "spend the point"
 * and "don't" can score identically on the real objective whenever the
 * target is doomed either way (e.g. two guaranteed-lethal hits and only one
 * saving point) or when nothing later ever depends on the exact box count -
 * and a bare `>` comparison would then default to *not* spending, which
 * reads as the target inexplicably refusing to defend itself on the hit
 * it's currently facing. Preferring to survive (or keep more boxes) now,
 * whenever that costs nothing on the real objective, matches how a
 * defensively-minded player would actually use these points.
 */
export function outcomeScore(branches: ResourceBranch[], valueAt: ValueLookup): [number, number, number] {
  let survivalValue = 0;
  let survivalProbability = 0;
  let expectedBoxes = 0;
  for (const b of branches) {
    if (b.destroyed) continue;
    survivalValue += b.probability * valueAt(b.boxes, b.debuffState, b.focusLeft, b.furyLeft, b.shieldGuardsLeft, b.scapegoatsLeft);
    survivalProbability += b.probability;
    expectedBoxes += b.probability * b.boxes;
  }
  return [survivalValue, survivalProbability, expectedBoxes];
}

const SCORE_EPSILON = 1e-9;

/** True if `a` is strictly better than `b` under the lexicographic order described above. */
export function isBetterScore(a: [number, number, number], b: [number, number, number]): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i] > b[i] + SCORE_EPSILON) return true;
    if (a[i] < b[i] - SCORE_EPSILON) return false;
  }
  return false;
}

/**
 * The attacker's own mirror of `isBetterScore`: an attacker spending Focus wants exactly the
 * OPPOSITE of what the target's own resources optimize for - the target's survival value/
 * probability/expected-boxes triple to be as LOW as possible, not high. Every comparison direction
 * simply flips (this is not "prefer lower boxes for its own sake", it's "prefer whatever is worse
 * for the target"). Used by the Attacker Focus boost-roll/damage-roll choices (see
 * `resolveAttackerAttackBoostChoice`/`resolveAttackerDamageBoostChoice` in single-target.ts) -
 * NOT by the bought-attacks weapon-selection ladder, which compares plain scalars directly instead
 * (see `buildBoughtAttacksValue`'s own doc comment for why that's a different comparison shape).
 */
export function isBetterForAttacker(a: [number, number, number], b: [number, number, number]): boolean {
  return isBetterScore(b, a);
}

/**
 * The target spends at most one resource on this hit - none, a focus point, a fury point, or (for
 * an eligible attack type) a Shield Guard/Scapegoat - whichever scores best (see `outcomeScore`).
 * `valueAt` (built by backward induction over the whole sequence) is what lets this look ahead
 * instead of just reacting to the current hit: e.g. mitigating a big-but-survivable hit can be
 * worth it purely to preserve boxes against what's still coming.
 *
 * A Shield Guard/Scapegoat block is a TRUE block, not mitigation like Focus/Fury: it uses
 * `oldDebuffState` (the state as it was BEFORE this hit's `statEffects` applied, reverting any
 * Knockdown/Ice Cage/etc. the hit would have inflicted) and calls `damageBranches` with both
 * `damageDealt`/`rawDamageDealt` at 0, so `healBranches`'s existing "no raw damage, no Rapid
 * Healing" gate applies automatically - no separate helper needed.
 *
 * Scored against a SEPARATE `blockValueAt` (rather than `valueAt`) because a block must also
 * suppress Critical Shred continuation, unlike every other candidate here - see
 * `resolveOneOutcome`'s doc comment for why two different lookups are needed and how the caller
 * knows which one applies to the branches this returns.
 */
export function bestAction(
  boxes: number,
  damageDealt: number,
  oldDebuffState: DebuffState,
  newDebuffState: DebuffState,
  focusLeft: number,
  furyLeft: number,
  shieldGuardsLeft: number,
  scapegoatsLeft: number,
  canBlockWithShieldGuard: boolean,
  canBlockWithScapegoat: boolean,
  tough: ToughRules,
  healing: HealingRules,
  valueAt: ValueLookup,
  blockValueAt: ValueLookup
): { branches: ResourceBranch[]; valueAt: ValueLookup } {
  // `damageDealt` here is always the RAW damage (before this hit's own Focus/Fury choice, if any)
  // - it's passed through unchanged as `rawDamageDealt` to every candidate below, regardless of
  // how much of it that candidate's own mitigation actually blocks - see `damageBranches`.
  let bestBranches = damageBranches(boxes, damageDealt, damageDealt, newDebuffState, focusLeft, furyLeft, shieldGuardsLeft, scapegoatsLeft, tough, healing);
  let bestScore = outcomeScore(bestBranches, valueAt);
  let bestValueAt = valueAt;

  if (focusLeft > 0) {
    const branches = damageBranches(
      boxes,
      Math.max(0, damageDealt - FOCUS_DAMAGE_REDUCTION),
      damageDealt,
      newDebuffState,
      focusLeft - 1,
      furyLeft,
      shieldGuardsLeft,
      scapegoatsLeft,
      tough,
      healing
    );
    const score = outcomeScore(branches, valueAt);
    if (isBetterScore(score, bestScore)) {
      bestBranches = branches;
      bestScore = score;
    }
  }

  if (furyLeft > 0) {
    const branches = damageBranches(boxes, 0, damageDealt, newDebuffState, focusLeft, furyLeft - 1, shieldGuardsLeft, scapegoatsLeft, tough, healing);
    const score = outcomeScore(branches, valueAt);
    if (isBetterScore(score, bestScore)) {
      bestBranches = branches;
      bestScore = score;
    }
  }

  if (canBlockWithShieldGuard && shieldGuardsLeft > 0) {
    const branches = damageBranches(boxes, 0, 0, oldDebuffState, focusLeft, furyLeft, shieldGuardsLeft - 1, scapegoatsLeft, tough, healing);
    const score = outcomeScore(branches, blockValueAt);
    if (isBetterScore(score, bestScore)) {
      bestBranches = branches;
      bestScore = score;
      bestValueAt = blockValueAt;
    }
  }

  if (canBlockWithScapegoat && scapegoatsLeft > 0) {
    const branches = damageBranches(boxes, 0, 0, oldDebuffState, focusLeft, furyLeft, shieldGuardsLeft, scapegoatsLeft - 1, tough, healing);
    const score = outcomeScore(branches, blockValueAt);
    if (isBetterScore(score, bestScore)) {
      bestBranches = branches;
      bestValueAt = blockValueAt;
    }
  }

  return { branches: bestBranches, valueAt: bestValueAt };
}
