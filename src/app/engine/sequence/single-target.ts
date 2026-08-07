import {
  AppliedOutcome,
  AttackProfile,
  applyProfile,
  boostedDamageMap,
  buildAttackProfile,
  splitAttackDamageByAverage,
} from '../attack-model';
import { DEF_FLOOR, MAX_FOCUS_ATTACKERS, MAX_PM_ATTACKERS, MAX_RESOURCE_POINTS, MAX_SCAPEGOATS, MAX_SHRED_DEPTH } from './constants';
import {
  DebuffState,
  INITIAL_DEBUFFS,
  applyStatEffectsForOutcome,
  debuffKey,
  effectiveDef,
  isKnockedDownOrStationary,
  isStationary,
} from './debuff-state';
import {
  ExtendedValueLookup,
  HealingRules,
  PmPopulation,
  ResourceBranch,
  ToughRules,
  ValueLookup,
  bestAction,
  branchesValue,
  isBetterForAttacker,
  isBetterScore,
  outcomeScore,
} from './resource-branches';
import { ValueTable, buildValueTable, readValueTable } from './value-table';
import {
  FocusStrategyEntry,
  RowInjection,
  SequencedAttack,
  SequenceOptions,
  SequenceResult,
  SequenceShotResult,
  SequenceStepResult,
  SequenceTarget,
  StatEffect,
} from './types';

/** The probability distribution over how many total shots actually fire: `attackCount`'s
 *  guaranteed base (defaults to 1), plus - for a `rof`-equipped RANGED attack - EXTRA shots
 *  decided ONCE, via a single die roll, before any of THIS attack's own dice are thrown (see the
 *  module doc comment's "Rate of Fire" section). Melee/arcane, or `rof` unset/'-', always fires
 *  exactly `attackCount` shots (no extra roll). */
function rofOutcomes(atk: SequencedAttack): { count: number; probability: number }[] {
  const base = atk.attackCount ?? 1;
  if (atk.type !== 'ranged' || !atk.rof || atk.rof === '-') {
    return [{ count: base, probability: 1 }];
  }
  if (atk.rof === 'd3') {
    return [1, 2, 3].map((extra) => ({ count: base + extra, probability: 1 / 3 }));
  }
  // '2d3': sum of two independent d3 rolls, faces 1-3 each equally likely, added to base.
  const dist = new Map<number, number>();
  for (let a = 1; a <= 3; a++) {
    for (let b = 1; b <= 3; b++) {
      dist.set(base + a + b, (dist.get(base + a + b) ?? 0) + 1 / 9);
    }
  }
  return [...dist.entries()].sort(([a], [b]) => a - b).map(([count, probability]) => ({ count, probability }));
}

/** Is THIS ONE ROW (regardless of ROF shot count or Critical Shred depth - both deliberately
 *  treated as "one roll opportunity", see the module doc comment's Knowledge of the Damned
 *  section) guaranteed to auto-hit given `debuffState`? Pure/no-lookahead: only static per-attack
 *  fields (`forceAutoHit`/`type`) plus whether `debuffState` is currently immobilizing - Knocked
 *  Down/Stationary never clears once inflicted, so this is safe to evaluate for ANY row (not just
 *  `k` itself) using the state as of THIS point. */
function rowIsAutoHitGuaranteed(atk: SequencedAttack, debuffState: DebuffState): boolean {
  return !!atk.forceAutoHit || (isKnockedDownOrStationary(debuffState) && atk.type === 'melee');
}

/** Everything `computeSequenceOdds` computes ONCE, up front, from `attacks`/`target`, that every
 *  hoisted helper below needs read-only access to - built once per call and threaded through as
 *  the first parameter of each, instead of 15+ individual near-identical bonus/buff values (an easy
 *  place to silently transpose two args) or relying on closure capture (which stops each helper
 *  from being independently readable/navigable). `profileCache` is the one genuinely MUTABLE field -
 *  shared, and intentionally mutated in place by `profileFor`, exactly as it was as a closure
 *  variable before this was pulled out into its own object. */
interface SequenceContext {
  attacks: SequencedAttack[];
  n: number;
  initialBoxes: number;
  toughRules: ToughRules;
  healingRules: HealingRules;
  rowActive: boolean[];
  baseDef: number;
  baseArm: number;
  defBonus: number;
  defBonusPostDispel: number;
  spellArmBonus: number;
  spellArmBonusPostDispel: number;
  nonSpellDefBonus: number;
  nonSpellDefBonusPostDispel: number;
  nonSpellArmBonus: number;
  nonSpellArmBonusPostDispel: number;
  shieldArmBonus: number;
  unyielding: boolean;
  unyieldingPostDispel: boolean;
  carapace: boolean;
  carapacePostDispel: boolean;
  pmBitOf: Map<number, number>;
  pmAttackIndicesByAttacker: Map<number, number[]>;
  /** Attacker Focus's own slot-index map (attackerIndex -> position in the `attackerFocusLeft`
   *  vector threaded everywhere below) - mirrors `pmBitOf`, but a slot INDEX rather than a bitmask
   *  bit, since each attacker's own Focus is a 0-10 count, not a single spent/unspent flag. */
  focusIndexOf: Map<number, number>;
  /** Every attack index (in `attacks`, in order) belonging to a given attacker - UNCONDITIONAL
   *  (every attacker, not just Focus-enabled ones), unlike `pmAttackIndicesByAttacker`. Needed by
   *  the bought-attacks feature to find an attacker's own candidate melee weapons and to detect
   *  "this attacker's own last configured row" regardless of Puppet Master - see
   *  `isLastAttackOfAttackerForFocus`. Deliberately a separate map: `pmAttackIndicesByAttacker` is
   *  PM-gated and `isAutoHitGuaranteedForRest` relies on that gating, so it can't be repurposed here. */
  attackIndicesByAttacker: Map<number, number[]>;
  profileCache: Map<string, AttackProfile>;
  /** Records the true-optimal Focus policy's own actual decisions during the FORWARD replay only
   *  (never during backward-pass scoring, which evaluates many hypothetical states no real branch
   *  ever reaches) - `undefined` whenever no attacker has Focus active, a verified no-op. Powers
   *  the Focus strategy summary text (see `summarizeFocusPolicy`) - the mutable counterpart to
   *  `profileCache` above. */
  focusPolicyLog?: FocusPolicyLog;
}

/** One (attacker, "situation") bucket's own weighted tally of which Attacker Focus action the
 *  true-optimal policy actually took, accumulated across the whole forward replay - "situation" is
 *  deliberately coarse (`healthy` vs `debuffed`, see `situationOf`) rather than a full state
 *  fingerprint, so the resulting text stays a short, readable summary instead of one line per
 *  reachable state. `hold` means Focus was available but nothing was spent on that particular
 *  decision point (a genuine, common outcome - not every roll is worth boosting). */
interface FocusPolicyTally {
  boostAttackMass: number;
  boostDamageMass: number;
  buyMass: number;
}

interface FocusPolicyLog {
  byAttackerAndSituation: Map<number, Map<'healthy' | 'debuffed', FocusPolicyTally>>;
}

/** Coarse "is the target already debuffed in some attack-relevant way" signal for
 *  `FocusPolicyLog`'s own bucketing - Knocked Down/Stationary specifically, since those are the
 *  two conditions that most directly change an attack's own odds (auto-hit for melee), matching
 *  the kind of branch point the user's own example ("boost attack rolls until Knocked Down, then
 *  boost damage rolls") describes. */
function situationOf(debuffState: DebuffState): 'healthy' | 'debuffed' {
  return isKnockedDownOrStationary(debuffState) ? 'debuffed' : 'healthy';
}

function recordFocusPolicy(
  ctx: SequenceContext,
  attackerIndex: number,
  debuffState: DebuffState,
  action: keyof FocusPolicyTally,
  mass: number
): void {
  if (!ctx.focusPolicyLog || mass <= 0) return;
  const situation = situationOf(debuffState);
  let byAttacker = ctx.focusPolicyLog.byAttackerAndSituation.get(attackerIndex);
  if (!byAttacker) {
    byAttacker = new Map();
    ctx.focusPolicyLog.byAttackerAndSituation.set(attackerIndex, byAttacker);
  }
  const tally = byAttacker.get(situation) ?? { boostAttackMass: 0, boostDamageMass: 0, buyMass: 0 };
  tally[action] += mass;
  byAttacker.set(situation, tally);
}

/** Is `k` this attacker's own LAST attack in the sequence? Purely static (no debuff-state or
 *  randomness involved) - see the module doc comment's Puppet Master section. */
function isLastAttackOfAttacker(ctx: SequenceContext, k: number, atk: SequencedAttack): boolean {
  const list = ctx.pmAttackIndicesByAttacker.get(atk.attackerIndex ?? -1);
  return !!list && list[list.length - 1] === k;
}

/** Is `k` this attacker's own last CONFIGURED attack - the boundary after which a bought attack
 *  (see `buildBoughtAttacksValue`) can fire? Same idea as `isLastAttackOfAttacker`, but built on
 *  the UNCONDITIONAL `attackIndicesByAttacker` (every attacker, not just Puppet-Master-active
 *  ones) - deliberately a separate function, not a reuse of the PM one, since PM's own gating is
 *  load-bearing for `isAutoHitGuaranteedForRest` and must not be widened. */
function isLastAttackOfAttackerForFocus(ctx: SequenceContext, k: number, atk: SequencedAttack): boolean {
  const list = ctx.attackIndicesByAttacker.get(atk.attackerIndex ?? -1);
  return !!list && list[list.length - 1] === k;
}

/** This row's own slot in the `attackerFocusLeft` vector, or `undefined` if its attacker has no
 *  Focus active at all - the single check every Attacker Focus decision point gates on first. */
function focusSlotOf(ctx: SequenceContext, atk: SequencedAttack): number | undefined {
  return ctx.focusIndexOf.get(atk.attackerIndex ?? -1);
}

/** Is it ALREADY clear, given `debuffState` as of entering attack `k`, that every one of this
 *  attacker's own attacks from `k` onward (inclusive) is guaranteed to auto-hit? See the module
 *  doc comment's Knowledge of the Damned section. */
function isAutoHitGuaranteedForRest(ctx: SequenceContext, k: number, atk: SequencedAttack, debuffState: DebuffState): boolean {
  const list = ctx.pmAttackIndicesByAttacker.get(atk.attackerIndex ?? -1) ?? [];
  return list.filter((j) => j >= k).every((j) => rowIsAutoHitGuaranteed(ctx.attacks[j], debuffState));
}

/** Count of rolls, system-wide across EVERY attacker, that could still miss - from `k`'s own
 *  remaining shots (`shotsRemainingThisRow`, already exactly known once inside this row's own ROF
 *  volley - see the module doc comment's Rate of Fire section) through the end of the sequence.
 *  This is the "reserve" Offensive Knowledge of the Damned's damage-roll check needs, generalizing
 *  Puppet Master's own single-token "is there anything left to miss" rule to N pooled charges. A
 *  LATER row's own ROF shot count isn't decided yet at decision time `k`, so its worst case
 *  (`maxShots`) is used - a safe upper bound, never an under-count. A Critical-Shred-active row is
 *  deliberately NOT expanded into multiple units, matching `isAutoHitGuaranteedForRest`'s own
 *  row-level treatment exactly. Pure/no-lookahead, same reasoning as `isAutoHitGuaranteedForRest`. */
function remainingMissableRollCount(ctx: SequenceContext, k: number, debuffState: DebuffState, shotsRemainingThisRow: number): number {
  const thisRow = rowIsAutoHitGuaranteed(ctx.attacks[k], debuffState) ? 0 : shotsRemainingThisRow;
  const laterRows = ctx.attacks.slice(k + 1).reduce((sum, row) => {
    if (rowIsAutoHitGuaranteed(row, debuffState)) return sum;
    const maxShots = Math.max(...rofOutcomes(row).map((o) => o.count));
    return sum + maxShots;
  }, 0);
  return thisRow + laterRows;
}

/** The "reserve rule": safe to spend an Offensive Knowledge of the Damned charge on a
 *  below-average damage roll only when enough charges would remain AFTERWARD to cover every
 *  remaining roll that could still miss - see the module doc comment. Collapses exactly onto
 *  Puppet Master's own "isAutoHitGuaranteedForRest OR isLastAttackOfAttacker" rule when
 *  `kotdOffLeft` is 1 (the only way `kotdOffLeft - 1 >= 0` remaining-count can hold is when that
 *  count is itself 0, i.e. nothing left to miss - exactly Puppet Master's condition). */
function damageRerollEligibleForOffKotd(
  ctx: SequenceContext,
  kotdOffLeft: number,
  k: number,
  debuffState: DebuffState,
  shotsRemainingThisRow: number
): boolean {
  return kotdOffLeft > 0 && kotdOffLeft - 1 >= remainingMissableRollCount(ctx, k, debuffState, shotsRemainingThisRow);
}

/** The (usesAutoHit, def, arm) triple a given attack resolves against at this point in the
 *  sequence - shared by `profileFor` and `damageCheckPopulations` below (via `arm`), so Puppet
 *  Master's own damage-roll check resolves against the exact same target context `profileFor`
 *  already does. */
function contextFor(ctx: SequenceContext, atk: SequencedAttack, debuffState: DebuffState, sustained: boolean): { usesAutoHit: boolean; def: number; arm: number } {
  const immobilized = isKnockedDownOrStationary(debuffState);
  const usesAutoHit = !!atk.forceAutoHit || sustained || (atk.type === 'melee' && immobilized);
  // Blessed drops only the SPELL-flagged Stat-type bonus (DEF and ARM); the non-spell counterpart
  // (a feat, a non-spell aura) is never Blessed-ignorable. Dispel drops whichever half of each is
  // currently flagged Dispellable, regardless of spell/non-spell. Both can apply at once.
  const activeStatDefBonus =
    (atk.blessed ? 0 : debuffState.dispelled ? ctx.defBonusPostDispel : ctx.defBonus) +
    (debuffState.dispelled ? ctx.nonSpellDefBonusPostDispel : ctx.nonSpellDefBonus);
  const activeStatArmBonus =
    (atk.blessed ? 0 : debuffState.dispelled ? ctx.spellArmBonusPostDispel : ctx.spellArmBonus) +
    (debuffState.dispelled ? ctx.nonSpellArmBonusPostDispel : ctx.nonSpellArmBonus);
  // Chain Weapon drops Shield's ARM bonus specifically, regardless of Dispel (a spell-granted
  // Shield isn't reachable from the current UI, so Dispel never needs to touch this component).
  const activeShieldArm = atk.chainWeapon ? 0 : ctx.shieldArmBonus;
  const def = effectiveDef(ctx.baseDef, debuffState) + activeStatDefBonus;
  // Unyielding/Carapace only apply against their specific attack type, so - unlike Shield and
  // spell bonuses - they're resolved per attack here rather than folded into a flat bonus. Once
  // Dispel has fired, fall back to whichever half of each pair matches (see `SequenceTarget`).
  const activeUnyielding = debuffState.dispelled ? ctx.unyieldingPostDispel : ctx.unyielding;
  const activeCarapace = debuffState.dispelled ? ctx.carapacePostDispel : ctx.carapace;
  const conditionalArmBonus =
    (activeUnyielding && atk.type === 'melee' ? 2 : 0) + (activeCarapace && atk.type === 'ranged' ? 4 : 0);
  const arm = ctx.baseArm - debuffState.armPenalty + activeShieldArm + activeStatArmBonus + conditionalArmBonus;
  return { usesAutoHit, def, arm };
}

/** `attackBoosted` (default `false`) rebuilds this roll's own attack dice pool with one extra die
 *  (`boostDice + 1`) - Attacker Focus's boost-attack-roll spend, see `resolveAttackerAttackBoostChoice`.
 *  It must be part of the cache key: omitting it would silently hand a caller asking for the
 *  boosted profile the cached UNBOOSTED one (or vice versa) the second time this exact
 *  (k, context) combination is seen - the sharpest correctness trap in the whole Attacker Focus
 *  feature, since nothing else about the call site would look wrong. */
function profileFor(ctx: SequenceContext, k: number, atk: SequencedAttack, debuffState: DebuffState, sustained: boolean, attackBoosted = false): AttackProfile {
  const { usesAutoHit, def, arm } = contextFor(ctx, atk, debuffState, sustained);
  const cacheKey = `${k}|${usesAutoHit}|${def}|${arm}|${debuffState.knockedDown}|${isStationary(debuffState)}|${attackBoosted}`;
  const cached = ctx.profileCache.get(cacheKey);
  if (cached) return cached;

  const modifiers = attackBoosted ? { ...atk.modifiers, boostDice: (atk.modifiers?.boostDice ?? 0) + 1 } : atk.modifiers;
  const profile = buildAttackProfile(
    { type: atk.type, stat: atk.stat, autoHit: usesAutoHit, modifiers },
    { pow: atk.pow, modifiers: atk.damageModifiers },
    { def, arm, baseArm: ctx.baseArm, knockedDown: debuffState.knockedDown, stationary: isStationary(debuffState) },
    atk.effects,
    usesAutoHit
  );
  ctx.profileCache.set(cacheKey, profile);
  return profile;
}

/** One sub-population arising from a below/above-average-damage-roll check - `spent: true` means
 *  this rule's reroll actually fired in this slice. Shared by every FIXED reroll rule (Puppet
 *  Master, Offensive Knowledge of the Damned) - see the module doc comment's "two profiles, not
 *  one" section: `hitMassToCheck` is THIS STAGE's own current mass (how much, and which portion,
 *  is even eligible here), while `trueOriginal` is the roll's true unconditional distribution
 *  (what a fresh reroll actually draws from) - these coincide for Puppet Master (the first stage)
 *  but diverge once Offensive Knowledge of the Damned sits downstream of it. */
interface AverageRerollPopulation {
  profile: AttackProfile;
  spent: boolean;
}

/** The two (non-crit and, if it can even happen, crit) sub-populations arising from a
 *  below-average-damage-roll check on `hitMassToCheck` - shared by every place that needs it (an
 *  auto-hit roll's only possible hit flavor is non-crit; a non-auto-hit roll's hit could be
 *  either). Each hit flavor present in `hitMassToCheck` (nonzero chance) contributes an "at/above
 *  average, stays unspent" population (properly renormalized via `normalizeMap`, with
 *  `hitNonCritChance`/`hitCritChance` correspondingly REDUCED to the true absolute mass - see
 *  `normalizeMap`'s doc comment) and, if any mass is below average, a "rerolled, now spent"
 *  population using `trueOriginal`'s own FULL damage map again (a reroll is an i.i.d. redraw from
 *  the SAME pool - see the module doc comment). */
function damageRerollPopulations(
  ctx: SequenceContext,
  atk: SequencedAttack,
  debuffState: DebuffState,
  hitMassToCheck: Pick<AttackProfile, 'hitNonCritChance' | 'hitCritChance'>,
  trueOriginal: AttackProfile,
  sustained: boolean
): AverageRerollPopulation[] {
  const { arm } = contextFor(ctx, atk, debuffState, sustained);
  const target = { arm, baseArm: ctx.baseArm, knockedDown: debuffState.knockedDown, stationary: isStationary(debuffState) };
  const damage = { pow: atk.pow, modifiers: atk.damageModifiers };
  const populations: AverageRerollPopulation[] = [];

  if (hitMassToCheck.hitNonCritChance > 0) {
    const split = splitAttackDamageByAverage(damage, atk.effects, target, 'nonCrit', 'rerollBelowAverage');
    const keptMass = hitMassToCheck.hitNonCritChance * (1 - split.rerollMass);
    if (keptMass > 0) {
      populations.push({
        profile: { missChance: 0, hitNonCritChance: keptMass, hitCritChance: 0, nonCritDamage: normalizeMap(split.kept, 1 - split.rerollMass), critDamage: new Map() },
        spent: false,
      });
    }
    if (split.rerollMass > 0) {
      populations.push({
        profile: { missChance: 0, hitNonCritChance: hitMassToCheck.hitNonCritChance * split.rerollMass, hitCritChance: 0, nonCritDamage: trueOriginal.nonCritDamage, critDamage: new Map() },
        spent: true,
      });
    }
  }
  if (hitMassToCheck.hitCritChance > 0) {
    const split = splitAttackDamageByAverage(damage, atk.effects, target, 'crit', 'rerollBelowAverage');
    const keptMass = hitMassToCheck.hitCritChance * (1 - split.rerollMass);
    if (keptMass > 0) {
      populations.push({
        profile: { missChance: 0, hitNonCritChance: 0, hitCritChance: keptMass, nonCritDamage: new Map(), critDamage: normalizeMap(split.kept, 1 - split.rerollMass) },
        spent: false,
      });
    }
    if (split.rerollMass > 0) {
      populations.push({
        profile: { missChance: 0, hitNonCritChance: 0, hitCritChance: hitMassToCheck.hitCritChance * split.rerollMass, nonCritDamage: new Map(), critDamage: trueOriginal.critDamage },
        spent: true,
      });
    }
  }
  return populations;
}

/**
 * Every sub-population that genuinely happens when resolving attack `k` (for THIS attacker),
 * given `pmMask` as it reads entering this roll - see the module doc comment's Puppet Master
 * section for the exact rule. Unlike Focus/Fury's `bestAction`, this is never a CHOICE: every
 * returned population actually occurs, in a different slice of this roll, each pre-scaled to its
 * own share of the mass entering it - the caller just sums over them like any other outcome.
 * Degenerates to `[{ profile: trueOriginal, resultingMask: pmMask }]` (today's exact
 * pre-Puppet-Master behavior) whenever this attacker has no unspent token, which is always true
 * when no attacker has Puppet Master active at all. `trueOriginal` is `profileFor(k, atk,
 * debuffState)` - computed ONCE by the caller and shared with every later stage (Offensive/
 * Defensive Knowledge of the Damned), since Puppet Master is always the FIRST stage in the
 * composition pipeline (see the module doc comment) and so is the only stage where "the mass in
 * front of me" and "what a reroll draws" ever coincide.
 */
function resolvePmSplit(
  ctx: SequenceContext,
  k: number,
  atk: SequencedAttack,
  debuffState: DebuffState,
  pmMask: number,
  trueOriginal: AttackProfile,
  sustained: boolean
): PmPopulation[] {
  const pmBit = ctx.pmBitOf.get(atk.attackerIndex ?? -1);
  const pmAvailable = pmBit !== undefined && (pmMask & pmBit) === 0;
  if (!pmAvailable) return [{ profile: trueOriginal, resultingMask: pmMask }];

  const spentMask = pmMask | pmBit;
  const { usesAutoHit } = contextFor(ctx, atk, debuffState, sustained);
  const damageCheckEligible = isAutoHitGuaranteedForRest(ctx, k, atk, debuffState) || isLastAttackOfAttacker(ctx, k, atk);
  const populations: PmPopulation[] = [];

  if (!usesAutoHit) {
    // "The first missed attack roll": the miss portion gets a full fresh redraw from the SAME
    // pool (a reroll IS an i.i.d. redraw - see the module doc comment), which is mathematically
    // identical to `trueOriginal` itself, scaled down to just its own missChance-sized share.
    if (trueOriginal.missChance > 0) {
      populations.push({
        profile: {
          missChance: trueOriginal.missChance * trueOriginal.missChance,
          hitNonCritChance: trueOriginal.missChance * trueOriginal.hitNonCritChance,
          hitCritChance: trueOriginal.missChance * trueOriginal.hitCritChance,
          nonCritDamage: trueOriginal.nonCritDamage,
          critDamage: trueOriginal.critDamage,
        },
        resultingMask: spentMask,
      });
    }
    // The hit portion stays unspent, UNLESS this roll ALSO qualifies for the damage-roll check
    // (a second chance on a hit that turned out to be this attacker's last real opportunity) -
    // see the module doc comment's point 3.
    if (damageCheckEligible) {
      for (const p of damageRerollPopulations(ctx, atk, debuffState, trueOriginal, trueOriginal, sustained)) {
        populations.push({ profile: p.profile, resultingMask: p.spent ? spentMask : pmMask });
      }
    } else if (trueOriginal.hitNonCritChance + trueOriginal.hitCritChance > 0) {
      populations.push({
        profile: { missChance: 0, hitNonCritChance: trueOriginal.hitNonCritChance, hitCritChance: trueOriginal.hitCritChance, nonCritDamage: trueOriginal.nonCritDamage, critDamage: trueOriginal.critDamage },
        resultingMask: pmMask,
      });
    }
  } else if (damageCheckEligible) {
    // Auto-hit: there's no attack roll to miss, so the only possible check is the damage roll
    // (always non-crit - an auto-hit attack can never crit, see attack-model.ts).
    for (const p of damageRerollPopulations(ctx, atk, debuffState, trueOriginal, trueOriginal, sustained)) {
      populations.push({ profile: p.profile, resultingMask: p.spent ? spentMask : pmMask });
    }
  } else {
    // Auto-hit, but not (yet) eligible for the damage check either - nothing to do at this roll,
    // the token stays reserved for a later opportunity.
    populations.push({ profile: trueOriginal, resultingMask: pmMask });
  }

  return populations;
}

/** One genuinely-occurring sub-population arising from Offensive Knowledge of the Damned's fixed
 *  rule at THIS roll - shaped like `PmPopulation` but tracking a charge COUNT (`resultingLeft`)
 *  rather than a bitmask, since Offensive Knowledge of the Damned's charges are fungible (a GLOBAL
 *  pool shared by every attacker, unlike Puppet Master's per-attacker token) - only HOW MANY
 *  charges remain matters, not which one was spent. */
interface KotdPopulation {
  profile: AttackProfile;
  resultingLeft: number;
}

/**
 * Every sub-population that genuinely happens when resolving attack `k` under Offensive Knowledge
 * of the Damned's fixed rule, given `kotdOffLeft` charges remaining entering this roll - a GLOBAL
 * pool shared by every attacker (unlike Puppet Master's per-attacker token), generalizing Puppet
 * Master's exact rule via the "reserve" eligibility check (`damageRerollEligibleForOffKotd`)
 * instead of PM's own per-attacker `isAutoHitGuaranteedForRest`/`isLastAttackOfAttacker`.
 * `inputProfile` is whatever profile the PREVIOUS stage (Puppet Master) produced for this
 * population; `trueOriginal` is always `profileFor(k, atk, debuffState)`, shared by every stage -
 * see the module doc comment's "two profiles" section. Never a CHOICE - every population returned
 * genuinely happens, pre-scaled to its own share, exactly like `resolvePmSplit`.
 */
function resolveKotdOffSplit(
  ctx: SequenceContext,
  k: number,
  atk: SequencedAttack,
  debuffState: DebuffState,
  kotdOffLeft: number,
  shotsRemainingThisRow: number,
  inputProfile: AttackProfile,
  trueOriginal: AttackProfile,
  sustained: boolean
): KotdPopulation[] {
  if (kotdOffLeft === 0) return [{ profile: inputProfile, resultingLeft: 0 }];

  const { usesAutoHit } = contextFor(ctx, atk, debuffState, sustained);
  const damageEligible = damageRerollEligibleForOffKotd(ctx, kotdOffLeft, k, debuffState, shotsRemainingThisRow);
  const populations: KotdPopulation[] = [];

  if (!usesAutoHit) {
    // Unconditional: any miss gets rerolled immediately, mirroring Puppet Master's own rule 1 -
    // never gated by the reserve check (only the DAMAGE-roll fallback needs to reserve charges).
    if (inputProfile.missChance > 0) {
      populations.push({
        profile: {
          missChance: inputProfile.missChance * trueOriginal.missChance,
          hitNonCritChance: inputProfile.missChance * trueOriginal.hitNonCritChance,
          hitCritChance: inputProfile.missChance * trueOriginal.hitCritChance,
          nonCritDamage: trueOriginal.nonCritDamage,
          critDamage: trueOriginal.critDamage,
        },
        resultingLeft: kotdOffLeft - 1,
      });
    }
    if (damageEligible) {
      for (const p of damageRerollPopulations(ctx, atk, debuffState, inputProfile, trueOriginal, sustained)) {
        populations.push({ profile: p.profile, resultingLeft: p.spent ? kotdOffLeft - 1 : kotdOffLeft });
      }
    } else if (inputProfile.hitNonCritChance + inputProfile.hitCritChance > 0) {
      populations.push({
        profile: { missChance: 0, hitNonCritChance: inputProfile.hitNonCritChance, hitCritChance: inputProfile.hitCritChance, nonCritDamage: inputProfile.nonCritDamage, critDamage: inputProfile.critDamage },
        resultingLeft: kotdOffLeft,
      });
    }
  } else if (damageEligible) {
    for (const p of damageRerollPopulations(ctx, atk, debuffState, inputProfile, trueOriginal, sustained)) {
      populations.push({ profile: p.profile, resultingLeft: p.spent ? kotdOffLeft - 1 : kotdOffLeft });
    }
  } else {
    populations.push({ profile: inputProfile, resultingLeft: kotdOffLeft });
  }

  return populations;
}

/** One genuinely-occurring sub-population arising from Attacker Focus's damage-roll boost choice -
 *  see `resolveAttackerDamageBoostChoice`. Shaped like `PmPopulation`/`KotdPopulation` but tracking
 *  the WHOLE `attackerFocusLeft` vector (only this attacker's own slot ever changes). */
interface AttackerFocusDamagePopulation {
  profile: AttackProfile;
  resultingAttackerFocusLeft: number[];
}

/**
 * Attacker Focus's damage-roll boost: a per-hit-flavor CHOICE (like Defensive Knowledge of the
 * Damned's own reroll choice), not a population that always happens (like Puppet Master/Offensive
 * Knowledge of the Damned) - by the time this runs, `finalProfile` already has a fixed
 * hitNonCritChance/hitCritChance split (Defensive Knowledge of the Damned's own choice, if any, has
 * already been made - see the module doc comment's Attacker Focus section for why this stage sits
 * AFTER `resolveKotdDefChoice` rather than before it), so each flavor can rationally decide
 * differently (e.g. always worth boosting a crit's damage, rarely worth it on an already-lethal
 * non-crit). Miss mass always passes through unchanged - there's no damage roll to boost on a miss.
 * Deliberate simplification: `resolveKotdDefChoice`'s OWN candidate comparison (via `profileScore`)
 * does not look ahead through THIS choice - Defensive Knowledge of the Damned is scored as if
 * Attacker Focus didn't exist. Folding this stage into `profileScore` itself would make it
 * self-referential (profileScore -> this function -> profileScore on a smaller slice -> this
 * function again, forever) - see the module doc comment for the full reasoning. A narrow, rare-in-
 * practice gap (both effects active on the very same roll), consistent with Phase 3's similar
 * Puppet-Master/Knowledge-of-the-Damned scope cut for bought attacks.
 */
function resolveAttackerDamageBoostChoice(
  ctx: SequenceContext,
  k: number,
  atk: SequencedAttack,
  debuffState: DebuffState,
  attackerFocusLeft: number[],
  finalProfile: AttackProfile,
  boxes: number,
  focusLeft: number,
  furyLeft: number,
  shieldGuardsLeft: number,
  scapegoatsLeft: number,
  resultingMask: number,
  resultingOffKotdLeft: number,
  resultingDefKotdLeft: number,
  shotsRemainingThisRow: number,
  sustained: boolean,
  depthRemaining: number,
  outerValueAt: ExtendedValueLookup,
  cache: Map<string, number>
): AttackerFocusDamagePopulation[] {
  const slot = focusSlotOf(ctx, atk);
  if (slot === undefined || attackerFocusLeft[slot] === 0) {
    return [{ profile: finalProfile, resultingAttackerFocusLeft: attackerFocusLeft }];
  }

  const populations: AttackerFocusDamagePopulation[] = [];
  if (finalProfile.missChance > 0) {
    populations.push({
      profile: { missChance: finalProfile.missChance, hitNonCritChance: 0, hitCritChance: 0, nonCritDamage: new Map(), critDamage: new Map() },
      resultingAttackerFocusLeft: attackerFocusLeft,
    });
  }

  const { arm } = contextFor(ctx, atk, debuffState, sustained);
  const target = { arm, baseArm: ctx.baseArm, knockedDown: debuffState.knockedDown, stationary: isStationary(debuffState) };
  const damage = { pow: atk.pow, modifiers: atk.damageModifiers };
  const boostedAttackerFocusLeft = attackerFocusLeft.slice();
  boostedAttackerFocusLeft[slot] -= 1;

  const scoreOf = (profile: AttackProfile, candidateFocusLeft: number[]) =>
    profileScore(
      ctx, profile, k, atk, debuffState, boxes, focusLeft, furyLeft, shieldGuardsLeft, scapegoatsLeft,
      resultingMask, resultingOffKotdLeft, resultingDefKotdLeft, candidateFocusLeft, shotsRemainingThisRow,
      sustained, depthRemaining, outerValueAt, cache
    );

  (['nonCrit', 'crit'] as const).forEach((variant) => {
    const hitChance = variant === 'nonCrit' ? finalProfile.hitNonCritChance : finalProfile.hitCritChance;
    if (hitChance <= 0) return;
    const keptProfile: AttackProfile =
      variant === 'nonCrit'
        ? { missChance: 0, hitNonCritChance: hitChance, hitCritChance: 0, nonCritDamage: finalProfile.nonCritDamage, critDamage: new Map() }
        : { missChance: 0, hitNonCritChance: 0, hitCritChance: hitChance, nonCritDamage: new Map(), critDamage: finalProfile.critDamage };
    const boostedMap = boostedDamageMap(damage, atk.effects, target, variant);
    const boostedProfile: AttackProfile =
      variant === 'nonCrit' ? { ...keptProfile, nonCritDamage: boostedMap } : { ...keptProfile, critDamage: boostedMap };

    const keptScore = scoreOf(keptProfile, attackerFocusLeft);
    const boostedScore = scoreOf(boostedProfile, boostedAttackerFocusLeft);
    populations.push(
      isBetterForAttacker(boostedScore, keptScore)
        ? { profile: boostedProfile, resultingAttackerFocusLeft: boostedAttackerFocusLeft }
        : { profile: keptProfile, resultingAttackerFocusLeft: attackerFocusLeft }
    );
  });

  return populations;
}

/** Reroll the damage roll if it's currently above average - the mirror image of Puppet
 *  Master/Offensive Knowledge of the Damned's own below-average check, via
 *  `splitAttackDamageByAverage(..., 'rerollAboveAverage')`. Produces ONE merged profile (via
 *  `mergeWeighted`) rather than splitting into two disjoint populations, since Defensive Knowledge
 *  of the Damned picks a single whole-profile CANDIDATE to compare, not a mixture that always
 *  happens. `hitNonCritChance`/`hitCritChance` stay exactly `inputProfile`'s own - only the damage
 *  MAPS change, since the reroll-or-keep mixture is folded entirely into them (see `mergeWeighted`). */
function rerollDamageIfAboveAverage(
  ctx: SequenceContext,
  atk: SequencedAttack,
  debuffState: DebuffState,
  inputProfile: AttackProfile,
  trueOriginal: AttackProfile,
  sustained: boolean
): AttackProfile {
  const { arm } = contextFor(ctx, atk, debuffState, sustained);
  const target = { arm, baseArm: ctx.baseArm, knockedDown: debuffState.knockedDown, stationary: isStationary(debuffState) };
  const damage = { pow: atk.pow, modifiers: atk.damageModifiers };

  let nonCritDamage = inputProfile.nonCritDamage;
  if (inputProfile.hitNonCritChance > 0) {
    const split = splitAttackDamageByAverage(damage, atk.effects, target, 'nonCrit', 'rerollAboveAverage');
    nonCritDamage = mergeWeighted(split.kept, split.rerollMass, trueOriginal.nonCritDamage);
  }
  let critDamage = inputProfile.critDamage;
  if (inputProfile.hitCritChance > 0) {
    const split = splitAttackDamageByAverage(damage, atk.effects, target, 'crit', 'rerollAboveAverage');
    critDamage = mergeWeighted(split.kept, split.rerollMass, trueOriginal.critDamage);
  }
  return { missChance: inputProfile.missChance, hitNonCritChance: inputProfile.hitNonCritChance, hitCritChance: inputProfile.hitCritChance, nonCritDamage, critDamage };
}

// `pmMask`/`kotdOffLeft`/`kotdDefLeft` are all small, densely-enumerated resource dimensions
// exactly like focus/fury, NOT a sparse reachability-pruned one like `DebuffState` - so they're
// folded into the same composite Map key `DebuffState` already uses (one `ValueTable` per
// reachable (debuffState, pmMask, kotdOffLeft, kotdDefLeft) tuple), rather than adding more array
// axes to `ValueTable` itself.
function tableKey(s: DebuffState, pmMask: number, kotdOffLeft: number, kotdDefLeft: number, attackerFocusLeft: number[]): string {
  return `${debuffKey(s)}|${pmMask}|${kotdOffLeft}|${kotdDefLeft}|${attackerFocusLeft.join(',')}`;
}

/** Rescales `map` so it sums to 1 - `splitAttackDamageByAverage`'s `kept` map deliberately sums
 *  to `1 - rerollMass` (a filtered SUBSET of the full dice pool, each entry keeping its own
 *  original probability), which is only safe to pair with an UNREDUCED `hitNonCritChance`/
 *  `hitCritChance` scalar if the resulting profile is consumed directly by `applyProfile` and
 *  never treated as a properly-normalized `AttackProfile` by anything downstream (as Defensive
 *  Knowledge of the Damned's `rerollDamageIfAboveAverage` does, via `mergeWeighted`) - see
 *  `damageRerollPopulations`, which uses this to keep every profile it returns honoring the
 *  normal `AttackProfile` contract (scalar x 1-summing map = absolute mass) throughout the whole
 *  pipeline, not just when Puppet Master is the only stage. */
function normalizeMap(map: Map<number, number>, sum: number): Map<number, number> {
  if (sum <= 0) return map;
  const normalized = new Map<number, number>();
  for (const [d, p] of map) normalized.set(d, p / sum);
  return normalized;
}

/** Reroll the attack roll if it's currently a hit - the mirror image of Puppet Master/Offensive
 *  Knowledge of the Damned's own miss-reroll (see the module doc comment's "two profiles"
 *  section): pure arithmetic on `AttackProfile`'s three chance scalars, no attack-model.ts helper
 *  needed (hit/crit/miss are exact `AttackProfile` aggregates, not lossy post-ARM buckets, unlike
 *  a damage roll). Only meaningful for a non-auto-hit roll - `resolveKotdDefChoice` guards that. */
function rerollAttackRollIfHit(inputProfile: AttackProfile, trueOriginal: AttackProfile): AttackProfile {
  const hitMass = inputProfile.hitNonCritChance + inputProfile.hitCritChance;
  return {
    missChance: inputProfile.missChance + hitMass * trueOriginal.missChance,
    hitNonCritChance: hitMass * trueOriginal.hitNonCritChance,
    hitCritChance: hitMass * trueOriginal.hitCritChance,
    nonCritDamage: trueOriginal.nonCritDamage,
    critDamage: trueOriginal.critDamage,
  };
}

/** Blends a below-average-rerolled-away damage map (`kept`, already scaled to sum to `1 -
 *  rerollMass`) with the rerolled-away mass redrawn fresh from `trueOriginalMap` (which sums to
 *  1) into ONE properly-normalized conditional distribution (summing back to 1) - used by
 *  `rerollDamageIfAboveAverage` to produce a single merged CANDIDATE profile, unlike
 *  `damageRerollPopulations`'s two disjoint populations (Defensive Knowledge of the Damned
 *  compares whole-profile candidates, it doesn't split mass into populations that all happen). */
function mergeWeighted(kept: Map<number, number>, rerollMass: number, trueOriginalMap: Map<number, number>): Map<number, number> {
  const merged = new Map<number, number>(kept);
  if (rerollMass > 0) {
    for (const [d, p] of trueOriginalMap) {
      merged.set(d, (merged.get(d) ?? 0) + rerollMass * p);
    }
  }
  return merged;
}

// Declared up here (rather than down by the forward simulation that mainly uses it) because
// `resolveAttackChainForward` needs the type for its `next` accumulator parameter.
interface FwdState {
  boxes: number;
  debuffState: DebuffState;
  focusLeft: number;
  furyLeft: number;
  shieldGuardsLeft: number;
  scapegoatsLeft: number;
  pmMask: number;
  kotdOffLeft: number;
  kotdDefLeft: number;
  /** This sequence's own attacker-Focus vector, one slot per focus-enabled attacker (see
   *  `SequenceContext.focusIndexOf`) - persists across rows exactly like `pmMask`/`kotdOffLeft`
   *  (it's a resource, not a per-row flag), unlike `sustained` below. */
  attackerFocusLeft: number[];
  /** Sustained Attack/Critical Sustained Attack state for THIS row's own volley - see the module
   *  doc comment. Reset to `false` whenever a new row's shot loop begins (`resolveRofAttackForward`). */
  sustained: boolean;
}
const fwdKey = (s: FwdState) =>
  `${s.boxes}|${debuffKey(s.debuffState)}|${s.focusLeft}|${s.furyLeft}|${s.shieldGuardsLeft}|${s.scapegoatsLeft}|${s.pmMask}|${s.kotdOffLeft}|${s.kotdDefLeft}|${s.attackerFocusLeft.join(',')}|${s.sustained}`;

/** Resolves one already-realized `AppliedOutcome` of attack `k` into its `ResourceBranch[]` (via
 *  `bestAction`'s Focus/Fury/Shield-Guard/Scapegoat choice, unaffected by anything above this
 *  level) plus the `ValueLookup` continuation that actually produced them - shared by
 *  `attackChainValue`'s own outer accumulation loop AND `profileScore` (Defensive Knowledge of
 *  the Damned's candidate scorer), so Critical Shred's recursive continuation logic is never
 *  duplicated (the single biggest correctness risk in this feature - see the module doc comment).
 *
 *  Passes TWO lookups into `bestAction`: `shredValueAt` (may recurse into another Critical Shred
 *  instance on a crit) for the nothing/Focus/Fury candidates, and `outerFallback` (always "attack
 *  k+1 onward", never re-enters Shred) for the Shield Guard/Scapegoat block candidates - a block
 *  is a TRUE block of this hit's consequences, so even a blocked crit doesn't chain, though it
 *  still counts toward Hit%/Crit% (those are tallied upstream from `outcome.isCrit`/`isHit`
 *  directly, never touching this function - see the module doc comment). `bestAction` returns
 *  whichever of the two lookups matches the candidate it actually picked, which this function
 *  forwards as `continuationValueAt` - callers always score the returned branches with the
 *  lookup that's consistent with how they were chosen. Also returns `continuesChain`, the SAME
 *  fact expressed as a boolean (true only when the raw outcome would chain AND the winning
 *  candidate wasn't a block) - `resolveAttackChainForward` needs this to physically route
 *  probability mass, since it can't compare function references the way `continuationValueAt`
 *  implicitly does.
 *
 *  Also where Sustained Attack actually gets decided: `outcomeSustained` turns on (and stays on)
 *  once a shot in THIS row's volley hits (`atk.sustainedAttack === 'hit'`) or specifically crits
 *  (`atk.sustainedAttack === 'crit'`) - passed to BOTH the Shred-continuation recursion (so a
 *  Shred-triggered follow-up attack sees a just-turned-on flag too) and `outerValueAt` (so the
 *  NEXT shot in the volley, or the next row once shots run out, does too - see the module doc
 *  comment's "Sustained Attack" section). Returned so the forward pass, which builds explicit
 *  `FwdState` objects instead of closures, can store it the same way it already stores
 *  `resultingMask`/`resultingOffKotdLeft`/`resultingDefKotdLeft`. */
function resolveOneOutcome(
  ctx: SequenceContext,
  outcome: AppliedOutcome,
  k: number,
  atk: SequencedAttack,
  debuffState: DebuffState,
  boxes: number,
  focusLeft: number,
  furyLeft: number,
  shieldGuardsLeft: number,
  scapegoatsLeft: number,
  resultingMask: number,
  resultingOffKotdLeft: number,
  resultingDefKotdLeft: number,
  attackerFocusLeft: number[],
  shotsRemainingThisRow: number,
  sustained: boolean,
  depthRemaining: number,
  outerValueAt: ExtendedValueLookup,
  cache: Map<string, number>
): { branches: ResourceBranch[]; continuationValueAt: ValueLookup; continuesChain: boolean; outcomeSustained: boolean } {
  const newDebuffState = applyStatEffectsForOutcome(debuffState, atk.statEffects, outcome.isCrit);
  const rawContinuesChain = outcome.isCrit && !!atk.criticalShred && depthRemaining > 0;
  const outcomeSustained =
    sustained || (atk.sustainedAttack === 'hit' && outcome.isHit) || (atk.sustainedAttack === 'crit' && outcome.isCrit);

  const outerFallback: ValueLookup = (b, d, f, fu, sg, sc) =>
    outerValueAt(b, d, f, fu, sg, sc, resultingMask, resultingOffKotdLeft, resultingDefKotdLeft, attackerFocusLeft, outcomeSustained);

  const shredValueAt: ValueLookup = rawContinuesChain
    ? (b, d, f, fu, sg, sc) =>
        attackChainValue(ctx, k, atk, d, b, f, fu, sg, sc, resultingMask, resultingOffKotdLeft, resultingDefKotdLeft, attackerFocusLeft, shotsRemainingThisRow, outcomeSustained, depthRemaining - 1, outerValueAt, cache)
    : outerFallback;

  const { branches, valueAt } = bestAction(
    boxes,
    outcome.damageDealt,
    debuffState /* old */,
    newDebuffState,
    focusLeft,
    furyLeft,
    shieldGuardsLeft,
    scapegoatsLeft,
    atk.type === 'ranged',
    atk.type === 'melee',
    ctx.toughRules,
    ctx.healingRules,
    shredValueAt,
    outerFallback
  );
  return { branches, continuationValueAt: valueAt, continuesChain: rawContinuesChain && valueAt !== outerFallback, outcomeSustained };
}

/** Aggregates `outcomeScore` (the SAME lexicographic survival-value/probability/expected-boxes
 *  triple `bestAction` already uses for Focus/Fury) across every outcome a WHOLE profile can
 *  produce, weighted by each outcome's own probability - the piece `bestAction` itself never
 *  needed, since it only ever scores a single already-realized outcome. Used ONLY to compare
 *  Defensive Knowledge of the Damned's candidate profiles against each other. */
function profileScore(
  ctx: SequenceContext,
  profile: AttackProfile,
  k: number,
  atk: SequencedAttack,
  debuffState: DebuffState,
  boxes: number,
  focusLeft: number,
  furyLeft: number,
  shieldGuardsLeft: number,
  scapegoatsLeft: number,
  resultingMask: number,
  resultingOffKotdLeft: number,
  candidateDefKotdLeft: number,
  attackerFocusLeft: number[],
  shotsRemainingThisRow: number,
  sustained: boolean,
  depthRemaining: number,
  outerValueAt: ExtendedValueLookup,
  cache: Map<string, number>
): [number, number, number] {
  let score: [number, number, number] = [0, 0, 0];
  for (const outcome of applyProfile(profile)) {
    const { branches, continuationValueAt } = resolveOneOutcome(
      ctx, outcome, k, atk, debuffState, boxes, focusLeft, furyLeft, shieldGuardsLeft, scapegoatsLeft,
      resultingMask, resultingOffKotdLeft, candidateDefKotdLeft, attackerFocusLeft, shotsRemainingThisRow,
      sustained, depthRemaining, outerValueAt, cache
    );
    const s = outcomeScore(branches, continuationValueAt);
    score = [score[0] + outcome.probability * s[0], score[1] + outcome.probability * s[1], score[2] + outcome.probability * s[2]];
  }
  return score;
}

/**
 * Defensive Knowledge of the Damned's genuine optimal choice (unlike Puppet Master/Offensive
 * Knowledge of the Damned's fixed-rule population splits): compares up to 3 whole-profile
 * candidates - don't spend / reroll the attack roll if it's a hit / reroll the damage roll if
 * it's above average - via `profileScore`, picking whichever candidate MAXIMIZES the target's
 * survival value, exactly the same `isBetterScore` comparison `bestAction` already uses for
 * Focus/Fury. `inputProfile` is Offensive Knowledge of the Damned's own output for this
 * population; `trueOriginal` is shared by every stage - see the module doc comment.
 */
function resolveKotdDefChoice(
  ctx: SequenceContext,
  k: number,
  atk: SequencedAttack,
  debuffState: DebuffState,
  kotdDefLeft: number,
  inputProfile: AttackProfile,
  trueOriginal: AttackProfile,
  boxes: number,
  focusLeft: number,
  furyLeft: number,
  shieldGuardsLeft: number,
  scapegoatsLeft: number,
  resultingMask: number,
  resultingOffKotdLeft: number,
  attackerFocusLeft: number[],
  shotsRemainingThisRow: number,
  sustained: boolean,
  depthRemaining: number,
  outerValueAt: ExtendedValueLookup,
  cache: Map<string, number>
): { profile: AttackProfile; resultingLeft: number } {
  if (kotdDefLeft === 0) return { profile: inputProfile, resultingLeft: 0 };

  const scoreOf = (profile: AttackProfile, candidateLeft: number) =>
    profileScore(ctx, profile, k, atk, debuffState, boxes, focusLeft, furyLeft, shieldGuardsLeft, scapegoatsLeft, resultingMask, resultingOffKotdLeft, candidateLeft, attackerFocusLeft, shotsRemainingThisRow, sustained, depthRemaining, outerValueAt, cache);

  let best = { profile: inputProfile, resultingLeft: kotdDefLeft };
  let bestScore = scoreOf(inputProfile, kotdDefLeft);

  const { usesAutoHit } = contextFor(ctx, atk, debuffState, sustained);
  if (!usesAutoHit) {
    const candidate = rerollAttackRollIfHit(inputProfile, trueOriginal);
    const score = scoreOf(candidate, kotdDefLeft - 1);
    if (isBetterScore(score, bestScore)) {
      best = { profile: candidate, resultingLeft: kotdDefLeft - 1 };
      bestScore = score;
    }
  }

  const dmgCandidate = rerollDamageIfAboveAverage(ctx, atk, debuffState, inputProfile, trueOriginal, sustained);
  const dmgScore = scoreOf(dmgCandidate, kotdDefLeft - 1);
  if (isBetterScore(dmgScore, bestScore)) {
    best = { profile: dmgCandidate, resultingLeft: kotdDefLeft - 1 };
  }

  return best;
}

/**
 * Resolves one instance of attack `k` starting from the given state, and - if that instance
 * crits and `atk.criticalShred` is set - recurses into ANOTHER instance of itself instead of
 * falling through to `outerValueAt` (which represents "attacks k+1 onward"), up to
 * `MAX_SHRED_DEPTH` deep. Attacks without Critical Shred take the `outerValueAt` branch on
 * every outcome, so this degenerates to exactly the pre-Shred single-instance computation - it
 * replaces the plain `bestAction`+`branchesValue` call at every use site, shred or not.
 * Memoized per (depthRemaining, debuffState, boxes, focus, fury, pmMask, kotdOffLeft,
 * kotdDefLeft): the same state is frequently reachable via multiple different paths through both
 * the recursion and the surrounding grid this is called from.
 *
 * Composes the full Knowledge of the Damned pipeline (see the module doc comment): Puppet
 * Master's `resolvePmSplit` -> Offensive Knowledge of the Damned's `resolveKotdOffSplit` -> Defensive
 * Knowledge of the Damned's `resolveKotdDefChoice`, each stage consuming the previous stage's
 * output profile, all three sharing the SAME `trueOriginal` (the roll's true unconditional
 * distribution - what a fresh reroll actually draws from). The first two are pure SUMS over
 * every population that genuinely happens; the third is a genuine CHOICE, run once per (Puppet
 * Master population x Offensive Knowledge of the Damned population). The Shred self-recursion
 * inside `resolveOneOutcome` passes each stage's OWN resulting resource values forward, not the
 * incoming ones - which is what makes every one of these resources correctly re-evaluable on
 * every instance of a chain, not just its first roll.
 */
/**
 * Aggregates the full Puppet Master -> Offensive Knowledge of the Damned -> Defensive Knowledge of
 * the Damned -> Attacker Focus damage-boost pipeline for ONE already-chosen `trueOriginal` (either
 * the unboosted or the attack-roll-boosted profile - see `resolveAttackerAttackBoostChoice`),
 * returning the full `[survivalValue, survivalProbability, expectedBoxes]` triple instead of
 * collapsing to a scalar like the pre-Focus `attackChainValue` used to - so two `trueOriginal`
 * candidates can be compared via `isBetterForAttacker`. Composes exactly the same four stages
 * `attackChainValue` always ran, just factored out so the outermost boost-or-not choice can run the
 * whole thing twice.
 */
function pipelineScore(
  ctx: SequenceContext,
  k: number,
  atk: SequencedAttack,
  debuffState: DebuffState,
  trueOriginal: AttackProfile,
  boxes: number,
  focusLeft: number,
  furyLeft: number,
  shieldGuardsLeft: number,
  scapegoatsLeft: number,
  pmMask: number,
  kotdOffLeft: number,
  kotdDefLeft: number,
  attackerFocusLeft: number[],
  shotsRemainingThisRow: number,
  sustained: boolean,
  depthRemaining: number,
  outerValueAt: ExtendedValueLookup,
  cache: Map<string, number>
): [number, number, number] {
  let score: [number, number, number] = [0, 0, 0];
  for (const { profile: pmProfile, resultingMask } of resolvePmSplit(ctx, k, atk, debuffState, pmMask, trueOriginal, sustained)) {
    for (const { profile: offProfile, resultingLeft: resultingOffKotdLeft } of resolveKotdOffSplit(
      ctx, k, atk, debuffState, kotdOffLeft, shotsRemainingThisRow, pmProfile, trueOriginal, sustained
    )) {
      const { profile: finalProfile, resultingLeft: resultingDefKotdLeft } = resolveKotdDefChoice(
        ctx, k, atk, debuffState, kotdDefLeft, offProfile, trueOriginal,
        boxes, focusLeft, furyLeft, shieldGuardsLeft, scapegoatsLeft, resultingMask, resultingOffKotdLeft, attackerFocusLeft,
        shotsRemainingThisRow, sustained, depthRemaining, outerValueAt, cache
      );
      for (const { profile: boostedFinalProfile, resultingAttackerFocusLeft } of resolveAttackerDamageBoostChoice(
        ctx, k, atk, debuffState, attackerFocusLeft, finalProfile,
        boxes, focusLeft, furyLeft, shieldGuardsLeft, scapegoatsLeft, resultingMask, resultingOffKotdLeft, resultingDefKotdLeft,
        shotsRemainingThisRow, sustained, depthRemaining, outerValueAt, cache
      )) {
        for (const outcome of applyProfile(boostedFinalProfile)) {
          const { branches, continuationValueAt } = resolveOneOutcome(
            ctx, outcome, k, atk, debuffState, boxes, focusLeft, furyLeft, shieldGuardsLeft, scapegoatsLeft,
            resultingMask, resultingOffKotdLeft, resultingDefKotdLeft, resultingAttackerFocusLeft, shotsRemainingThisRow,
            sustained, depthRemaining, outerValueAt, cache
          );
          const s = outcomeScore(branches, continuationValueAt);
          score = [score[0] + outcome.probability * s[0], score[1] + outcome.probability * s[1], score[2] + outcome.probability * s[2]];
        }
      }
    }
  }
  return score;
}

/**
 * Attacker Focus's boost-attack-roll choice - the OUTERMOST decision in the whole pipeline, unlike
 * every other stage here: boosting the attack roll changes what `trueOriginal` itself IS (a bigger
 * dice pool), and every downstream stage's own reroll logic redraws from `trueOriginal` (see the
 * module doc comment's "two profiles" section) - so it cannot be inserted as a middle stage the way
 * Defensive Knowledge of the Damned or Attacker Focus's own damage-roll boost can. Builds both the
 * unboosted and boosted `trueOriginal` via `profileFor`'s own `attackBoosted` flag, runs each
 * through the ENTIRE rest of the pipeline via `pipelineScore`, and picks whichever is worse for the
 * target via `isBetterForAttacker`. A no-op (single `pipelineScore` call, no comparison) whenever
 * this row's attacker has no Focus slot or has none left - the common case. Returns the winning
 * `trueOriginal`/resulting Focus alongside its score so the forward pass
 * (`resolveAttackChainForward`) can replay the SAME choice instead of just its numeric value -
 * `resolveAttackerAttackBoostChoice` (used by the backward pass, which only ever needs the number)
 * is a thin wrapper around this.
 */
function chooseAttackerAttackBoost(
  ctx: SequenceContext,
  k: number,
  atk: SequencedAttack,
  debuffState: DebuffState,
  boxes: number,
  focusLeft: number,
  furyLeft: number,
  shieldGuardsLeft: number,
  scapegoatsLeft: number,
  pmMask: number,
  kotdOffLeft: number,
  kotdDefLeft: number,
  attackerFocusLeft: number[],
  shotsRemainingThisRow: number,
  sustained: boolean,
  depthRemaining: number,
  outerValueAt: ExtendedValueLookup,
  cache: Map<string, number>
): { trueOriginal: AttackProfile; attackerFocusLeft: number[]; score: [number, number, number] } {
  const unboostedOriginal = profileFor(ctx, k, atk, debuffState, sustained, false);
  const unboostedScore = pipelineScore(
    ctx, k, atk, debuffState, unboostedOriginal, boxes, focusLeft, furyLeft, shieldGuardsLeft, scapegoatsLeft,
    pmMask, kotdOffLeft, kotdDefLeft, attackerFocusLeft, shotsRemainingThisRow, sustained, depthRemaining, outerValueAt, cache
  );

  const slot = focusSlotOf(ctx, atk);
  if (slot === undefined || attackerFocusLeft[slot] === 0) {
    return { trueOriginal: unboostedOriginal, attackerFocusLeft, score: unboostedScore };
  }

  const boostedOriginal = profileFor(ctx, k, atk, debuffState, sustained, true);
  const boostedAttackerFocusLeft = attackerFocusLeft.slice();
  boostedAttackerFocusLeft[slot] -= 1;
  const boostedScore = pipelineScore(
    ctx, k, atk, debuffState, boostedOriginal, boxes, focusLeft, furyLeft, shieldGuardsLeft, scapegoatsLeft,
    pmMask, kotdOffLeft, kotdDefLeft, boostedAttackerFocusLeft, shotsRemainingThisRow, sustained, depthRemaining, outerValueAt, cache
  );

  return isBetterForAttacker(boostedScore, unboostedScore)
    ? { trueOriginal: boostedOriginal, attackerFocusLeft: boostedAttackerFocusLeft, score: boostedScore }
    : { trueOriginal: unboostedOriginal, attackerFocusLeft, score: unboostedScore };
}

function resolveAttackerAttackBoostChoice(
  ctx: SequenceContext,
  k: number,
  atk: SequencedAttack,
  debuffState: DebuffState,
  boxes: number,
  focusLeft: number,
  furyLeft: number,
  shieldGuardsLeft: number,
  scapegoatsLeft: number,
  pmMask: number,
  kotdOffLeft: number,
  kotdDefLeft: number,
  attackerFocusLeft: number[],
  shotsRemainingThisRow: number,
  sustained: boolean,
  depthRemaining: number,
  outerValueAt: ExtendedValueLookup,
  cache: Map<string, number>
): number {
  return chooseAttackerAttackBoost(
    ctx, k, atk, debuffState, boxes, focusLeft, furyLeft, shieldGuardsLeft, scapegoatsLeft,
    pmMask, kotdOffLeft, kotdDefLeft, attackerFocusLeft, shotsRemainingThisRow, sustained, depthRemaining, outerValueAt, cache
  ).score[0];
}

/**
 * Resolves one instance of attack `k` starting from the given state, and - if that instance
 * crits and `atk.criticalShred` is set - recurses into ANOTHER instance of itself instead of
 * falling through to `outerValueAt` (which represents "attacks k+1 onward"), up to
 * `MAX_SHRED_DEPTH` deep. Attacks without Critical Shred take the `outerValueAt` branch on
 * every outcome, so this degenerates to exactly the pre-Shred single-instance computation - it
 * replaces the plain `bestAction`+`branchesValue` call at every use site, shred or not.
 * Memoized per (depthRemaining, debuffState, boxes, focus, fury, pmMask, kotdOffLeft,
 * kotdDefLeft, attackerFocusLeft): the same state is frequently reachable via multiple different
 * paths through both the recursion and the surrounding grid this is called from. A thin wrapper
 * around `resolveAttackerAttackBoostChoice` (the outermost decision - see its own doc comment),
 * which in turn composes the rest of the Puppet Master/Knowledge of the Damned/Attacker Focus
 * pipeline via `pipelineScore`.
 */
function attackChainValue(
  ctx: SequenceContext,
  k: number,
  atk: SequencedAttack,
  debuffState: DebuffState,
  boxes: number,
  focusLeft: number,
  furyLeft: number,
  shieldGuardsLeft: number,
  scapegoatsLeft: number,
  pmMask: number,
  kotdOffLeft: number,
  kotdDefLeft: number,
  attackerFocusLeft: number[],
  shotsRemainingThisRow: number,
  sustained: boolean,
  depthRemaining: number,
  outerValueAt: ExtendedValueLookup,
  cache: Map<string, number>
): number {
  const key = `${depthRemaining}|${debuffKey(debuffState)}|${boxes}|${focusLeft}|${furyLeft}|${shieldGuardsLeft}|${scapegoatsLeft}|${pmMask}|${kotdOffLeft}|${kotdDefLeft}|${attackerFocusLeft.join(',')}|${sustained}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const total = resolveAttackerAttackBoostChoice(
    ctx, k, atk, debuffState, boxes, focusLeft, furyLeft, shieldGuardsLeft, scapegoatsLeft,
    pmMask, kotdOffLeft, kotdDefLeft, attackerFocusLeft, shotsRemainingThisRow, sustained, depthRemaining, outerValueAt, cache
  );

  cache.set(key, total);
  return total;
}

/** Per-shot forward-pass accumulator (one instance per shot INDEX within a row's own volley, not
 *  one per row) - `occursMass` is the probability mass that actually attempts this shot (see
 *  `SequenceShotResult.occursChance`'s doc comment), summed by `resolveRofAttackForward` BEFORE
 *  calling `resolveAttackChainForward`, which then adds `hitMass`/`critMass`/`damageMass` to the
 *  SAME object. */
interface ShotStats {
  hitMass: number;
  critMass: number;
  damageMass: number;
  occursMass: number;
}

/** Destroyed probability mass for one shot-position bucket, broken down by each focus-enabled
 *  attacker's own remaining Focus at the moment of death - `mass` is the same total
 *  `destroyChanceByShotsRemaining` has always tracked; `byFocus` is the extra coordinate
 *  `computeMultiTargetSequenceOdds` needs to correctly hand Attacker Focus forward to the next
 *  target (see the module doc comment's Attacker Focus section) - empty whenever no attacker has
 *  Focus active (attackerFocusLeft is always `[]` then, one entry total). */
interface DestroyedAccumulator {
  mass: number;
  byFocus: Map<string, { attackerFocusRemaining: number[]; mass: number }>;
}

function recordDestroyed(acc: DestroyedAccumulator, attackerFocusRemaining: number[], pp: number): void {
  acc.mass += pp;
  const key = attackerFocusRemaining.join(',');
  const existing = acc.byFocus.get(key);
  if (existing) existing.mass += pp;
  else acc.byFocus.set(key, { attackerFocusRemaining, mass: pp });
}

/** Folds `from`'s own mass into `into` in place - used to fold a bought attack's own destroyed
 *  mass (attributed to `shotsRemaining: 0`, see `resolveBoughtAttacksForward`'s own doc comment)
 *  into the row's own accumulator for that bucket. */
function mergeDestroyed(into: DestroyedAccumulator, from: DestroyedAccumulator): void {
  for (const { attackerFocusRemaining, mass } of from.byFocus.values()) {
    recordDestroyed(into, attackerFocusRemaining, mass);
  }
}

/**
 * Forward-simulation counterpart of `attackChainValue`: resolves one instance of attack `k`
 * starting from `probability` of the sequence being in the given state, accumulating into
 * `stats`/`next`/`destroyed` by mutation rather than returning a value, matching the imperative
 * style the rest of the forward pass already uses. If `atk.criticalShred` is set, a crit
 * continues the chain into another instance of the SAME attack, resolved one depth level at a
 * time: every state reached at a given depth is merged (by `fwdKey`) into a single map BEFORE
 * resolving the next instance against it, rather than recursing per-branch. That merge is the
 * whole point - two different paths through the chain landing on the same (boxes, debuffState,
 * focus, fury) get resolved together instead of separately, so this stays proportional to the
 * number of DISTINCT states reached, exactly like `attackChainValue`'s cache does. A naive
 * per-branch recursion here would instead redo its ~11-way branch at every depth independently:
 * cheap for a couple of levels, but up to 11^`MAX_SHRED_DEPTH` in the worst case, which is why
 * this isn't written that way. `stats.hitMass`/`critMass` only accumulate for the FIRST instance
 * (depth === `MAX_SHRED_DEPTH`) - "Hit"/"Crit" chance are the ORIGINAL roll's own (a single
 * well-defined probability), unlike "Avg damage" which stays meaningful summed across however
 * many instances actually fired (see the module doc comment). `stats` is always THIS shot's own
 * `ShotStats` accumulator (see `resolveRofAttackForward`) - every shot gets its own tracked
 * hit/crit/damage, not just a row's first shot.
 */
function resolveAttackChainForward(
  ctx: SequenceContext,
  k: number,
  atk: SequencedAttack,
  debuffState: DebuffState,
  boxes: number,
  focusLeft: number,
  furyLeft: number,
  shieldGuardsLeft: number,
  scapegoatsLeft: number,
  pmMask: number,
  kotdOffLeft: number,
  kotdDefLeft: number,
  attackerFocusLeft: number[],
  shotsRemainingThisRow: number,
  sustained: boolean,
  probability: number,
  outerValueAt: ExtendedValueLookup,
  shredCache: Map<string, number>,
  stats: ShotStats,
  next: Map<string, { state: FwdState; probability: number }>,
  destroyed: DestroyedAccumulator
): void {
  const initialState: FwdState = { boxes, debuffState, focusLeft, furyLeft, shieldGuardsLeft, scapegoatsLeft, pmMask, kotdOffLeft, kotdDefLeft, attackerFocusLeft, sustained };
  let current = new Map<string, { state: FwdState; probability: number }>([
    [fwdKey(initialState), { state: initialState, probability }],
  ]);
  let depthRemaining = MAX_SHRED_DEPTH;

  while (current.size > 0) {
    const topLevel = depthRemaining === MAX_SHRED_DEPTH;
    const continuing = new Map<string, { state: FwdState; probability: number }>();

    for (const { state, probability: p0 } of current.values()) {
      if (p0 <= 0) continue;
      // Re-derives the SAME pipeline the backward pass already ran for this exact state (not a
      // fresh/independent one) - see `resolvePmSplit`'s own doc comment for why this is
      // guaranteed to match whatever `attackChainValue` summed over/chose. Puppet Master and
      // Offensive Knowledge of the Damned are never a competing choice, so this loops over ALL
      // of their populations; Defensive Knowledge of the Damned's choice (and Attacker Focus's
      // own attack-roll/damage-roll boost choices) are recomputed fresh (pure functions of
      // reproducible inputs, exactly like `bestAction` already is in both passes today).
      const { trueOriginal, attackerFocusLeft: postBoostFocusLeft } = chooseAttackerAttackBoost(
        ctx, k, atk, state.debuffState, state.boxes, state.focusLeft, state.furyLeft, state.shieldGuardsLeft, state.scapegoatsLeft,
        state.pmMask, state.kotdOffLeft, state.kotdDefLeft, state.attackerFocusLeft, shotsRemainingThisRow,
        state.sustained, depthRemaining, outerValueAt, shredCache
      );
      // Reference equality: `chooseAttackerAttackBoost` returns the SAME `attackerFocusLeft` array
      // it was given when it kept the unboosted candidate, and a freshly-sliced one when it picked
      // the boosted candidate - a cheap, reliable way to tell which one won without widening its
      // own return type just for this.
      if (postBoostFocusLeft !== state.attackerFocusLeft) {
        recordFocusPolicy(ctx, atk.attackerIndex ?? 0, state.debuffState, 'boostAttackMass', p0);
      }
      for (const { profile: pmProfile, resultingMask } of resolvePmSplit(ctx, k, atk, state.debuffState, state.pmMask, trueOriginal, state.sustained)) {
        for (const { profile: offProfile, resultingLeft: resultingOffKotdLeft } of resolveKotdOffSplit(
          ctx, k, atk, state.debuffState, state.kotdOffLeft, shotsRemainingThisRow, pmProfile, trueOriginal, state.sustained
        )) {
          const { profile: finalProfile, resultingLeft: resultingDefKotdLeft } = resolveKotdDefChoice(
            ctx, k, atk, state.debuffState, state.kotdDefLeft, offProfile, trueOriginal,
            state.boxes, state.focusLeft, state.furyLeft, state.shieldGuardsLeft, state.scapegoatsLeft,
            resultingMask, resultingOffKotdLeft, postBoostFocusLeft, shotsRemainingThisRow,
            state.sustained, depthRemaining, outerValueAt, shredCache
          );
          for (const { profile: boostedFinalProfile, resultingAttackerFocusLeft } of resolveAttackerDamageBoostChoice(
            ctx, k, atk, state.debuffState, postBoostFocusLeft, finalProfile,
            state.boxes, state.focusLeft, state.furyLeft, state.shieldGuardsLeft, state.scapegoatsLeft,
            resultingMask, resultingOffKotdLeft, resultingDefKotdLeft, shotsRemainingThisRow,
            state.sustained, depthRemaining, outerValueAt, shredCache
          )) {
            if (resultingAttackerFocusLeft !== postBoostFocusLeft) {
              const populationMass = boostedFinalProfile.missChance + boostedFinalProfile.hitNonCritChance + boostedFinalProfile.hitCritChance;
              recordFocusPolicy(ctx, atk.attackerIndex ?? 0, state.debuffState, 'boostDamageMass', p0 * populationMass);
            }
            for (const outcome of applyProfile(boostedFinalProfile)) {
              const p = p0 * outcome.probability;
              if (p <= 0) continue;
              if (topLevel) {
                if (outcome.isHit) stats.hitMass += p;
                if (outcome.isCrit) stats.critMass += p;
              }
              stats.damageMass += p * outcome.damageDealt;

              const { branches, continuesChain, outcomeSustained } = resolveOneOutcome(
                ctx, outcome, k, atk, state.debuffState, state.boxes, state.focusLeft, state.furyLeft,
                state.shieldGuardsLeft, state.scapegoatsLeft,
                resultingMask, resultingOffKotdLeft, resultingDefKotdLeft, resultingAttackerFocusLeft, shotsRemainingThisRow,
                state.sustained, depthRemaining, outerValueAt, shredCache
              );

              for (const b of branches) {
                const pp = p * b.probability;
                if (pp <= 0) continue;
                if (b.destroyed) {
                  recordDestroyed(destroyed, resultingAttackerFocusLeft, pp);
                  continue;
                }
                const fwd: FwdState = {
                  boxes: b.boxes, debuffState: b.debuffState, focusLeft: b.focusLeft, furyLeft: b.furyLeft,
                  shieldGuardsLeft: b.shieldGuardsLeft, scapegoatsLeft: b.scapegoatsLeft,
                  pmMask: resultingMask, kotdOffLeft: resultingOffKotdLeft, kotdDefLeft: resultingDefKotdLeft,
                  attackerFocusLeft: resultingAttackerFocusLeft,
                  sustained: outcomeSustained,
                };
                const key = fwdKey(fwd);
                const target = continuesChain ? continuing : next;
                const existing = target.get(key);
                if (existing) existing.probability += pp;
                else target.set(key, { state: fwd, probability: pp });
              }
            }
          }
        }
      }
    }

    current = continuing;
    depthRemaining--;
  }
}

/** `onProgress`, if given, is called once per attack in the forward simulation with `(k + 1) / n`
 *  (1.0 on the last attack) - a coarse, UNEVEN proxy for "how much work is left": the backward
 *  induction/lazy value-table building that happens before the forward loop even starts (see the
 *  module doc comment's "Lazy value tables" section) isn't itself instrumented, and the FIRST
 *  attack's own forward step is typically what triggers most of that work (later steps mostly
 *  reuse what's already cached) - so progress can jump straight to a large fraction on step 1, then
 *  crawl for the rest, rather than advancing smoothly. */
export function computeSequenceOdds(
  attacks: SequencedAttack[],
  target: SequenceTarget,
  onProgress?: (fraction: number) => void,
  options?: SequenceOptions
): SequenceResult {
  const initialBoxes = target.boxes;
  const maxFocus = Math.floor(target.focusPoints ?? 0);
  const maxFury = Math.floor(target.furyPoints ?? 0);
  if (maxFocus < 0 || maxFury < 0) {
    throw new Error('focusPoints and furyPoints must not be negative');
  }
  if (maxFocus > MAX_RESOURCE_POINTS || maxFury > MAX_RESOURCE_POINTS) {
    throw new Error(`focusPoints/furyPoints=${maxFocus}/${maxFury} is unrealistically large (cap: ${MAX_RESOURCE_POINTS})`);
  }
  const maxKotdOff = Math.floor(target.offensiveKnowledgeOfTheDamned ?? 0);
  const maxKotdDef = Math.floor(target.defensiveKnowledgeOfTheDamned ?? 0);
  if (maxKotdOff < 0 || maxKotdDef < 0) {
    throw new Error('offensiveKnowledgeOfTheDamned and defensiveKnowledgeOfTheDamned must not be negative');
  }
  if (maxKotdOff > MAX_RESOURCE_POINTS || maxKotdDef > MAX_RESOURCE_POINTS) {
    throw new Error(`Knowledge of the Damned charges=${maxKotdOff}/${maxKotdDef} is unrealistically large (cap: ${MAX_RESOURCE_POINTS})`);
  }
  const maxShieldGuards = Math.floor(target.shieldGuards ?? 0);
  const maxScapegoats = Math.floor(target.scapegoats ?? 0);
  if (maxShieldGuards < 0 || maxScapegoats < 0) {
    throw new Error('shieldGuards and scapegoats must not be negative');
  }
  if (maxShieldGuards > MAX_RESOURCE_POINTS) {
    throw new Error(`shieldGuards=${maxShieldGuards} is unrealistically large (cap: ${MAX_RESOURCE_POINTS})`);
  }
  if (maxScapegoats > MAX_SCAPEGOATS) {
    throw new Error(`scapegoats=${maxScapegoats} is unrealistically large (cap: ${MAX_SCAPEGOATS})`);
  }
  // `ValueTable` grows these two as DENSE array axes (like focus/fury), not folded into `tableKey`
  // like Puppet Master/Knowledge of the Damned (see the module doc comment's Shield Guards/
  // Scapegoats section) - so unlike those Map-folded dimensions, this multiplies the size of every
  // table actually built, by up to (maxShieldGuards+1)*(maxScapegoats+1), on top of the existing
  // (maxFocus+1)*(maxFury+1) factor already there. There's no laziness benefit inside a dense
  // array the way `getValueTableAt` gives Puppet Master/Knowledge of the Damned - this is a
  // different kind of cost, not a restatement of that one. At realistic UI ranges (boxes <= 99)
  // this stays bounded and acceptable.
  const toughRules: ToughRules = {
    hasTough: !!target.tough,
    hasToughSteady: !!target.toughSteady,
    hasToughPostDispel: !!target.toughPostDispel,
    hasToughSteadyPostDispel: !!target.toughSteadyPostDispel,
    failChance: 0,
  };
  const hasAnyTough = toughRules.hasTough || toughRules.hasToughSteady;
  toughRules.failChance = hasAnyTough ? ((target.toughOn ?? 5) - 1) / 6 : 0;
  const healingRules: HealingRules = { hasRapidHealing: !!target.rapidHealing, initialBoxes };
  const n = attacks.length;

  // See the module doc comment's "Multiple targets" section. Omitted entirely (every existing
  // caller/test), this reproduces today's exact single-target behavior: every row active, 100% of
  // the mass starting fresh before row 0.
  const rowActive = options?.rowActive ?? attacks.map(() => true);
  const injectionsByRow = new Map<number, RowInjection[]>();
  for (const inj of options?.injection ?? [{ row: 0, shotsRemaining: 0, probability: 1 }]) {
    const list = injectionsByRow.get(inj.row);
    if (list) list.push(inj);
    else injectionsByRow.set(inj.row, [inj]);
  }

  // DEF = 'KD' means the target starts the sequence Knocked Down (see SequenceTarget doc).
  const startsKnockedDown = target.def === 'KD';
  // `baseDef`/`baseArm` stay the target's PRINTED stats, with no buffs (Shield/Unyielding/Carapace/
  // spell bonuses) or debuffs folded in - Armor Piercing explicitly ignores both (see `profileFor`).
  const baseDef = typeof target.def === 'number' ? target.def : DEF_FLOOR;
  const baseArm = target.arm;
  const defBonus = target.defBonus ?? 0;
  const defBonusPostDispel = target.defBonusPostDispel ?? 0;
  const shieldArmBonus = target.shieldArmBonus ?? 0;
  const spellArmBonus = target.spellArmBonus ?? 0;
  const spellArmBonusPostDispel = target.spellArmBonusPostDispel ?? 0;
  const nonSpellDefBonus = target.nonSpellDefBonus ?? 0;
  const nonSpellDefBonusPostDispel = target.nonSpellDefBonusPostDispel ?? 0;
  const nonSpellArmBonus = target.nonSpellArmBonus ?? 0;
  const nonSpellArmBonusPostDispel = target.nonSpellArmBonusPostDispel ?? 0;
  const unyielding = !!target.unyielding;
  const unyieldingPostDispel = !!target.unyieldingPostDispel;
  const carapace = !!target.carapace;
  const carapacePostDispel = !!target.carapacePostDispel;

  // Puppet Master: one bit per DISTINCT attacker index that has it active (not per attack, and
  // never shared across attackers) - see the module doc comment's Puppet Master section. With no
  // attacker active, `pmAttackerIndices` is empty and `maxPmMask === 1` (only mask 0 ever exists),
  // which is what makes every new code path below a verified no-op when the feature isn't used.
  const pmAttackerIndices = [...new Set(attacks.filter((a) => a.hasPuppetMaster).map((a) => a.attackerIndex ?? 0))];
  if (pmAttackerIndices.length > MAX_PM_ATTACKERS) {
    throw new Error(`Puppet Master active on ${pmAttackerIndices.length} attackers (cap: ${MAX_PM_ATTACKERS})`);
  }
  const pmBitOf = new Map<number, number>(pmAttackerIndices.map((idx, i) => [idx, 1 << i]));
  const maxPmMask = 1 << pmAttackerIndices.length;

  // Every attack index (in `attacks`, in order) belonging to a given PM-active attacker - used by
  // `isLastAttackOfAttacker`/`isAutoHitGuaranteedForRest` below. `hasPuppetMaster` is always set
  // uniformly true on EVERY attack of a PM-active attacker (see attacker.model.ts/attack-row.model.ts),
  // so filtering by it already scopes this to exactly that attacker's own attacks.
  const pmAttackIndicesByAttacker = new Map<number, number[]>();
  attacks.forEach((a, k) => {
    if (!a.hasPuppetMaster) return;
    const idx = a.attackerIndex ?? 0;
    const list = pmAttackIndicesByAttacker.get(idx);
    if (list) list.push(k);
    else pmAttackIndicesByAttacker.set(idx, [k]);
  });

  // Attacker Focus: one slot per DISTINCT attacker index with `attackerFocus` set - see the module
  // doc comment's Attacker Focus section. With no attacker using Focus, `focusAttackerIndices` is
  // empty and every new code path below (boost-attack-roll, boost-damage-roll, bought attacks) is a
  // verified no-op, same reasoning as `pmAttackerIndices` above.
  const focusAttackerIndices = [...new Set(attacks.filter((a) => (a.attackerFocus ?? 0) > 0).map((a) => a.attackerIndex ?? 0))];
  if (focusAttackerIndices.length > MAX_FOCUS_ATTACKERS) {
    throw new Error(`Focus active on ${focusAttackerIndices.length} attackers (cap: ${MAX_FOCUS_ATTACKERS})`);
  }
  const focusIndexOf = new Map<number, number>(focusAttackerIndices.map((idx, i) => [idx, i]));
  const initialAttackerFocus = focusAttackerIndices.map((idx) => {
    const focus = Math.floor(attacks.find((a) => (a.attackerIndex ?? 0) === idx)?.attackerFocus ?? 0);
    if (focus > MAX_RESOURCE_POINTS) {
      throw new Error(`attackerFocus=${focus} is unrealistically large (cap: ${MAX_RESOURCE_POINTS})`);
    }
    return focus;
  });

  // Every ACTIVE attack index (in `attacks`, in order) belonging to a given attacker - UNCONDITIONAL
  // on Puppet Master (every attacker, not PM-gated like `pmAttackIndicesByAttacker`) - see
  // `SequenceContext.attackIndicesByAttacker`'s own doc comment for why this can't reuse that map.
  // Filtered by `rowActive`: in a multi-target sequence, a row scoped to a LATER target still sits
  // in `attacks` (just inactive for THIS target's own computation) - counting it here would make
  // `isLastAttackOfAttackerForFocus` miss this target's own true last active row, silently
  // disabling buying for the whole rest of this target's fight. Also correctly keeps a row that's
  // out of range for this target from ever being offered as a bought-attack candidate weapon.
  const attackIndicesByAttacker = new Map<number, number[]>();
  attacks.forEach((a, k) => {
    if (!rowActive[k]) return;
    const idx = a.attackerIndex ?? 0;
    const list = attackIndicesByAttacker.get(idx);
    if (list) list.push(k);
    else attackIndicesByAttacker.set(idx, [k]);
  });

  // Attack profiles depend on the target's CURRENT debuffs (DEF/ARM/status), so they can't be
  // built once per attack like before a target could change mid-sequence - but the number of
  // distinct (autoHit, DEF, ARM, knockedDown, stationary) contexts actually encountered is
  // small, so caching per attack index keeps the expensive dice enumeration from ever repeating.
  const profileCache = new Map<string, AttackProfile>();

  const ctx: SequenceContext = {
    attacks,
    n,
    initialBoxes,
    toughRules,
    healingRules,
    rowActive,
    baseDef,
    baseArm,
    defBonus,
    defBonusPostDispel,
    spellArmBonus,
    spellArmBonusPostDispel,
    nonSpellDefBonus,
    nonSpellDefBonusPostDispel,
    nonSpellArmBonus,
    nonSpellArmBonusPostDispel,
    shieldArmBonus,
    unyielding,
    unyieldingPostDispel,
    carapace,
    carapacePostDispel,
    pmBitOf,
    pmAttackIndicesByAttacker,
    focusIndexOf,
    attackIndicesByAttacker,
    profileCache,
    focusPolicyLog: focusAttackerIndices.length > 0 ? { byAttackerAndSituation: new Map() } : undefined,
  };



  /**
   * A Rate of Fire attack fires its shot count K (see `rofOutcomes`) ALL decided upfront, before
   * any dice are rolled - so by the time the target is deciding whether to spend Focus/Fury on
   * shot i, it already knows exactly how many shots remain in THIS volley (i < K), not merely an
   * average over an unknown future (see the module doc comment). `shotsValue(s, ...)` is built as
   * a small recursive value function, one memoized "level" per remaining-shot-count s (0..maxShots
   * for this attack), rather than a single blended lookahead: `shotsValue(0, ...)` is exactly
   * "attacks k+1 onward" (`getNextTable`); `shotsValue(s, ...)` for s > 0 is "resolve one more shot
   * of this attack (`attackChainValue`, which already handles that one shot's own Critical Shred
   * chain if any), then `shotsValue(s-1, ...)` afterward". A single cache PER LEVEL s (not one per
   * grid point) is safe and sufficient, exactly like the plain per-attack `shredCache` used to be:
   * `shotsValue(s-1, ...)` is a pure function of (boxes, debuffState, focus, fury) alone, identical
   * no matter which debuffState/grid-point this level was entered from. Returned rather than
   * inlined so the forward pass below can reuse the exact same functions (and their caches) as its
   * own per-shot lookahead, keeping the replayed Focus/Fury policy consistent with what the
   * backward pass actually optimized for. `getNextTable` is a LAZY, memoized accessor (see "Lazy
   * value tables" below) rather than a pre-built `Map` - `shotsValue`'s own base case is exactly
   * the point where "attacks k+1 onward" is first actually needed, so this is where that laziness
   * bottoms out into a real (and then cached) computation.
   */
  function buildShotsValue(
    k: number,
    atk: SequencedAttack,
    getNextTable: (debuffState: DebuffState, pmMask: number, kotdOffLeft: number, kotdDefLeft: number, attackerFocusLeft: number[]) => ValueTable
  ): (
    shotsRemaining: number,
    debuffState: DebuffState,
    boxes: number,
    focusLeft: number,
    furyLeft: number,
    shieldGuardsLeft: number,
    scapegoatsLeft: number,
    pmMask: number,
    kotdOffLeft: number,
    kotdDefLeft: number,
    attackerFocusLeft: number[],
    sustained: boolean
  ) => number {
    const maxShots = Math.max(...rofOutcomes(atk).map((o) => o.count));
    const cachesByShotsRemaining: Map<string, number>[] = Array.from({ length: maxShots + 1 }, () => new Map());

    function shotsValue(
      shotsRemaining: number,
      debuffState: DebuffState,
      boxes: number,
      focusLeft: number,
      furyLeft: number,
      shieldGuardsLeft: number,
      scapegoatsLeft: number,
      pmMask: number,
      kotdOffLeft: number,
      kotdDefLeft: number,
      attackerFocusLeft: number[],
      sustained: boolean
    ): number {
      if (shotsRemaining === 0) {
        const table = getNextTable(debuffState, pmMask, kotdOffLeft, kotdDefLeft, attackerFocusLeft);
        return readValueTable(table, boxes, focusLeft, furyLeft, shieldGuardsLeft, scapegoatsLeft);
      }
      return attackChainValue(
        ctx,
        k,
        atk,
        debuffState,
        boxes,
        focusLeft,
        furyLeft,
        shieldGuardsLeft,
        scapegoatsLeft,
        pmMask,
        kotdOffLeft,
        kotdDefLeft,
        attackerFocusLeft,
        shotsRemaining - 1,
        sustained,
        MAX_SHRED_DEPTH,
        (b, d, f, fu, sg, sc, m, o, dk, afl, sus) => shotsValue(shotsRemaining - 1, d, b, f, fu, sg, sc, m, o, dk, afl, sus),
        cachesByShotsRemaining[shotsRemaining]
      );
    }

    return shotsValue;
  }

  /**
   * Attacker Focus's "buy an extra melee attack" ladder - the value of everything AFTER attacker
   * `attackerIndex`'s own last configured row, as a function of how much Focus that ONE attacker
   * still has left (every other coordinate - debuffState, the target's own resources, pmMask,
   * Knowledge of the Damned charges, every OTHER attacker's own Focus slot - is already fixed by
   * the caller). Shaped like `buildShotsValue`'s own `shotsValue(shotsRemaining, ...)` ladder
   * (`boughtTable(0, ...)` bottoms out at `getNextTable`), but choosing a WEAPON at each level (the
   * best of the attacker's own melee candidates, or stopping) instead of resolving one fixed
   * attack, and recursing on the ACTUAL resulting Focus count (`afl[slot]`) rather than a fixed
   * decrement - a bought shot can ALSO spend Focus boosting its own attack/damage roll (Phase 2),
   * so "how much is left after this bought shot" isn't always exactly one less. Buying is naturally
   * bounded by `focusLeft` itself (<= `MAX_RESOURCE_POINTS`), so no separate cap is needed.
   *
   * Each candidate weapon is resolved via `attackChainValue` with `shotsRemainingThisRow: 0` (a
   * bought attack is always a standalone singleton, never part of a Rate of Fire volley) - it goes
   * through the FULL pipeline (Tough/Rapid Healing/target Focus-Fury/Shield Guard/Critical
   * Shred/Sustained Attack/this attacker's own further boost choices all apply normally, since a
   * bought attack is a genuine attack). Picks the BEST candidate (stop, or one of the melee
   * weapons) via a plain numeric comparison, not `isBetterForAttacker`'s lexicographic triple -
   * `attackChainValue` already collapses to the single scalar these need to be compared as (whole
   * downstream expected-values, not single-outcome branches), so the triple's tie-break semantics
   * don't apply here.
   *
   * Deliberate scope cut: a bought attack reuses its weapon's own row index for Puppet Master/
   * Offensive Knowledge of the Damned eligibility - exactly right for Puppet Master (a pure mask
   * check, unaffected by which instance of the row spends the token) but can slightly mis-estimate
   * Offensive Knowledge of the Damned's own "reserve" heuristic (it sees whatever rows originally
   * followed this weapon's row, not "nothing else, this is the last roll of the fight"). Narrow,
   * and only affects that heuristic's own accuracy - never the bought attack's own hit/damage math,
   * nor how much it consumes/produces target-side resources.
   *
   * Returns `nextTable` (the `getNextTable`-shaped accessor, wired into `buildShotsValue` for this
   * attacker's own last row) alongside `valueAt` (the read-through `ExtendedValueLookup` view of
   * the SAME ladder - "value of playing this ladder optimally from here, including further buying")
   * and `stopValueAt` (a read-through of the ORIGINAL, UNWRAPPED `getNextTable` - "value of
   * genuinely stopping, no more buying at all"). The forward pass (`resolveBoughtAttacksForward`)
   * needs BOTH, not just `valueAt`: comparing a candidate weapon's own value against `valueAt`
   * itself would be comparing against an already-optimal (possibly-still-buying) baseline instead
   * of a genuine "stop" baseline - the same two roles `boughtTable`'s own fill function below keeps
   * separate (`getNextTable` for its `best` baseline vs recursing into itself for continued buying).
   */
  function buildBoughtAttacksValue(
    attackerIndex: number,
    getNextTable: (debuffState: DebuffState, pmMask: number, kotdOffLeft: number, kotdDefLeft: number, attackerFocusLeft: number[]) => ValueTable
  ): {
    nextTable: (debuffState: DebuffState, pmMask: number, kotdOffLeft: number, kotdDefLeft: number, attackerFocusLeft: number[]) => ValueTable;
    valueAt: ExtendedValueLookup;
    stopValueAt: ExtendedValueLookup;
  } {
    const slot = ctx.focusIndexOf.get(attackerIndex)!;
    const candidateWeapons = (ctx.attackIndicesByAttacker.get(attackerIndex) ?? []).filter((w) => ctx.attacks[w].type === 'melee');
    const tableCachesByFocusLeft: Map<string, ValueTable>[] = Array.from({ length: MAX_RESOURCE_POINTS + 1 }, () => new Map());
    // One attackChainValue cache PER (focus level, weapon) - never shared across different weapons
    // at the same level, since attackChainValue's own cache key doesn't include `k`/the weapon
    // index (safe everywhere else in this file because a single cache is always scoped to one
    // fixed `k` already - see buildShotsValue). Sharing one cache across multiple weapons here
    // would let one weapon's cached value get silently returned for a different weapon's query.
    const chainCachesByFocusLeftAndWeapon: Map<number, Map<string, number>>[] = Array.from({ length: MAX_RESOURCE_POINTS + 1 }, () => new Map());

    function boughtTable(focusLeftHere: number, debuffState: DebuffState, pmMask: number, kotdOffLeft: number, kotdDefLeft: number, attackerFocusLeft: number[]): ValueTable {
      const key = tableKey(debuffState, pmMask, kotdOffLeft, kotdDefLeft, attackerFocusLeft);
      const cache = tableCachesByFocusLeft[focusLeftHere];
      const cached = cache.get(key);
      if (cached) return cached;

      const table = buildValueTable(initialBoxes, maxFocus, maxFury, maxShieldGuards, maxScapegoats, (boxes, focus, fury, shieldGuards, scapegoats) => {
        const stopFocusLeft = attackerFocusLeft.slice();
        stopFocusLeft[slot] = focusLeftHere;
        let best = readValueTable(getNextTable(debuffState, pmMask, kotdOffLeft, kotdDefLeft, stopFocusLeft), boxes, focus, fury, shieldGuards, scapegoats);

        if (focusLeftHere > 0) {
          const spentFocusLeft = attackerFocusLeft.slice();
          spentFocusLeft[slot] = focusLeftHere - 1;
          for (const w of candidateWeapons) {
            let weaponCache = chainCachesByFocusLeftAndWeapon[focusLeftHere].get(w);
            if (!weaponCache) {
              weaponCache = new Map<string, number>();
              chainCachesByFocusLeftAndWeapon[focusLeftHere].set(w, weaponCache);
            }
            const value = attackChainValue(
              ctx, w, attacks[w], debuffState, boxes, focus, fury, shieldGuards, scapegoats,
              pmMask, kotdOffLeft, kotdDefLeft, spentFocusLeft, 0, false, MAX_SHRED_DEPTH,
              (b, d, f, fu, sg, sc, m, o, dk, afl, sus) => readValueTable(boughtTable(afl[slot], d, m, o, dk, afl), b, f, fu, sg, sc),
              weaponCache
            );
            if (value < best) best = value;
          }
        }

        return best;
      });

      cache.set(key, table);
      return table;
    }

    const nextTable = (debuffState: DebuffState, pmMask: number, kotdOffLeft: number, kotdDefLeft: number, attackerFocusLeft: number[]) =>
      boughtTable(attackerFocusLeft[slot], debuffState, pmMask, kotdOffLeft, kotdDefLeft, attackerFocusLeft);
    const valueAt: ExtendedValueLookup = (boxes, debuffState, focus, fury, shieldGuards, scapegoats, pmMask, kotdOffLeft, kotdDefLeft, attackerFocusLeft) =>
      readValueTable(nextTable(debuffState, pmMask, kotdOffLeft, kotdDefLeft, attackerFocusLeft), boxes, focus, fury, shieldGuards, scapegoats);
    const stopValueAt: ExtendedValueLookup = (boxes, debuffState, focus, fury, shieldGuards, scapegoats, pmMask, kotdOffLeft, kotdDefLeft, attackerFocusLeft) =>
      readValueTable(getNextTable(debuffState, pmMask, kotdOffLeft, kotdDefLeft, attackerFocusLeft), boxes, focus, fury, shieldGuards, scapegoats);

    return { nextTable, valueAt, stopValueAt };
  }

  // --- Backward induction ---
  // getValueTableAt[k](debuffState, pmMask, kotdOffLeft, kotdDefLeft) gives one (boxes x focus x
  // fury) table, giving P(survive attacks[k..n-1] onward | state), playing the optimal Focus/Fury
  // policy. getValueTableAt[n] is the base case: no attacks left, so any alive state has already
  // survived - the SAME table regardless of state, built once and shared, never keyed at all.
  //
  // Lazy value tables: earlier versions of this engine eagerly built a table for EVERY reachable
  // debuffState (via a dedicated `computeReachableDebuffStates` precomputation pass) x every
  // `pmMask`/`kotdOffLeft`/`kotdDefLeft` combination, at every step k, before any of it was known
  // to be needed. Once Knowledge of the Damned's charge counters made that cross product genuinely
  // large (up to 11 x 11 per debuffState x mask), most of that eager work turned out to be wasted:
  // a short sequence can never actually reach a state that has spent more charges than it has had
  // rolls, for instance, so entire slices of the grid were built and then never read. Each
  // `getValueTableAt[k]` below is instead a memoized accessor (`cache`, one `Map` per k, replacing
  // the old eager `valueTables[k]` Map one-for-one) that builds a table THE FIRST TIME it's asked
  // for a given `(debuffState, pmMask, kotdOffLeft, kotdDefLeft)` tuple, and returns the cached
  // table on every later ask - so only combinations some real branch of the computation actually
  // reaches ever get built at all, and each still only ever gets built once. This is exactly the
  // same "compute on demand, remember it" idea `attackChainValue`'s own `cache` parameter already
  // uses one level down - just applied to the (boxes x focus x fury) table as a whole instead of a
  // single number. Building the accessors bottom-up (`k = n` down to `0`, same order as before)
  // still matters: `getValueTableAt[k]`'s own build step calls `shotsValueByAttack[k]`, which in
  // turn calls `getValueTableAt[k + 1]` at its own base case - so accessors must exist before a
  // LATER one's build step can call into them, even though no actual TABLE gets built until the
  // forward simulation below first asks for one.
  const baseValueTable = buildValueTable(initialBoxes, maxFocus, maxFury, maxShieldGuards, maxScapegoats, () => 1);
  const getValueTableAt: ((debuffState: DebuffState, pmMask: number, kotdOffLeft: number, kotdDefLeft: number, attackerFocusLeft: number[]) => ValueTable)[] = new Array(n + 1);
  getValueTableAt[n] = () => baseValueTable;

  // Attacker Focus's own "keep buying after every configured row is done" ladder - deliberately
  // SEPARATE from `boughtAttacksValueAtByAttacker` below (built per-attacker at THAT attacker's own
  // last configured row, which can sit strictly before `n` when a LATER row belongs to a different,
  // non-Focus-enabled attacker - wrong to reuse here, since that ladder still expects those later
  // rows to fire). This one is always rooted at the true terminal table (`getValueTableAt[n]`,
  // "nothing else happens") and exists purely for `RowInjection.row === n` mass arriving from an
  // EARLIER multi-target target - an attacker who already exhausted every configured row against
  // that earlier target, but still has Focus left over, gets one more chance to keep buying against
  // THIS target instead of that leftover Focus silently vanishing (see the module doc comment's
  // Multiple targets / Attacker Focus sections, and `computeMultiTargetSequenceOdds`'s own routing
  // of such entries into `ownInjection` only when they carry spendable Focus). Chained
  // attacker-by-attacker in a fixed (ascending index) order, exactly like the normal per-row hook
  // chains through `getValueTableAt[k+1]` - each later attacker's own "stop" baseline is "the
  // earlier attacker already bought optimally", not the bare terminal table. A complete no-op
  // (empty map) whenever no attacker has Focus active, and never touched at all unless a `row: n`
  // injection actually exists (never true for a plain single-target call).
  const terminalBoughtLookups = new Map<number, { valueAt: ExtendedValueLookup; stopValueAt: ExtendedValueLookup }>();
  {
    let chainTable = getValueTableAt[n];
    for (const attackerIdx of [...ctx.focusIndexOf.keys()].sort((a, b) => a - b)) {
      const bought = buildBoughtAttacksValue(attackerIdx, chainTable);
      terminalBoughtLookups.set(attackerIdx, { valueAt: bought.valueAt, stopValueAt: bought.stopValueAt });
      chainTable = bought.nextTable;
    }
  }

  // Built once per attack as the backward pass reaches it, then reused by the forward pass below.
  const shotsValueByAttack: ((shotsRemaining: number, debuffState: DebuffState, boxes: number, focusLeft: number, furyLeft: number, shieldGuardsLeft: number, scapegoatsLeft: number, pmMask: number, kotdOffLeft: number, kotdDefLeft: number, attackerFocusLeft: number[], sustained: boolean) => number)[] =
    new Array(n);

  // Attacker Focus's own "buy an extra attack" ladder, one per focus-enabled attacker, built once
  // at that attacker's own last-configured-row boundary and reused (its `valueAt`/`stopValueAt`) by
  // the forward pass at that exact same boundary - see `buildBoughtAttacksValue`'s own doc comment.
  const boughtAttacksValueAtByAttacker = new Map<number, { valueAt: ExtendedValueLookup; stopValueAt: ExtendedValueLookup }>();

  for (let k = n - 1; k >= 0; k--) {
    const atk = attacks[k];
    if (!rowActive[k]) {
      // No-op row for this target (weapon out of range - see the module doc comment's "Multiple
      // targets" section): "attacks k..n-1" is worth exactly what "attacks k+1..n-1" is worth, so
      // alias straight through rather than building a table nobody needs.
      getValueTableAt[k] = getValueTableAt[k + 1];
      continue;
    }
    const attackerIdx = atk.attackerIndex ?? 0;
    let nextTableForShots = getValueTableAt[k + 1];
    if (ctx.focusIndexOf.has(attackerIdx) && isLastAttackOfAttackerForFocus(ctx, k, atk)) {
      const bought = buildBoughtAttacksValue(attackerIdx, getValueTableAt[k + 1]);
      nextTableForShots = bought.nextTable;
      boughtAttacksValueAtByAttacker.set(attackerIdx, { valueAt: bought.valueAt, stopValueAt: bought.stopValueAt });
    }
    const shotsValue = buildShotsValue(k, atk, nextTableForShots);
    shotsValueByAttack[k] = shotsValue;
    const rofDist = rofOutcomes(atk);
    const cache = new Map<string, ValueTable>();

    getValueTableAt[k] = (debuffState, mask, off, def, attackerFocusLeft) => {
      const key = tableKey(debuffState, mask, off, def, attackerFocusLeft);
      const cached = cache.get(key);
      if (cached) return cached;
      const table = buildValueTable(initialBoxes, maxFocus, maxFury, maxShieldGuards, maxScapegoats, (boxes, focus, fury, shieldGuards, scapegoats) =>
        rofDist.reduce((sum, { count, probability }) => sum + probability * shotsValue(count, debuffState, boxes, focus, fury, shieldGuards, scapegoats, mask, off, def, attackerFocusLeft, false), 0)
      );
      cache.set(key, table);
      return table;
    };
  }

  /**
   * Forward-simulation counterpart of `buildShotsValue`: fires attack `k`'s full Rate of Fire
   * volley starting from `initialDist`, splitting each incoming state's probability mass across
   * every possible shot count (`rofDist`), then resolving that many `resolveAttackChainForward`
   * calls in sequence per branch - each shot's survivors becoming the next shot's starting
   * distribution WITHIN THAT SAME branch, exactly mirroring `shotsValue`'s own per-branch
   * recursion above (so `bestAction`'s Focus/Fury lookahead, called from inside
   * `resolveAttackChainForward`, sees the correct value for "however many shots THIS branch's own
   * K actually leaves remaining", not a blended average). `shotStats[shotIndex - 1]` is THAT shot
   * index's own `ShotStats` accumulator (shared across every `count` branch that reaches this far -
   * see `SequenceShotResult`'s doc comment) - before resolving a given shot index, the incoming
   * `current` map's probability is summed into that shot's own `occursMass` (the mass that actually
   * attempts it), then `resolveAttackChainForward` adds its `hitMass`/`critMass`/`damageMass` on top.
   */
  function resolveRofAttackForward(
    k: number,
    atk: SequencedAttack,
    initialDist: Map<string, { state: FwdState; probability: number }>,
    shotsValue: (shotsRemaining: number, debuffState: DebuffState, boxes: number, focusLeft: number, furyLeft: number, shieldGuardsLeft: number, scapegoatsLeft: number, pmMask: number, kotdOffLeft: number, kotdDefLeft: number, attackerFocusLeft: number[], sustained: boolean) => number,
    shotStats: ShotStats[],
    destroyedByShotsRemaining: DestroyedAccumulator[],
    next: Map<string, { state: FwdState; probability: number }>,
    partialInjections: RowInjection[]
  ): void {
    /** Resolves exactly `count` sequential shots of this row's weapon starting from `initial`,
     *  feeding survivors of the LAST shot into `next` - shared by every branch below (a normally
     *  ROF-rolled count, or a fixed count resumed mid-volley via `partialInjections` - see the
     *  module doc comment's "Multiple targets" section), since both are just "some number of this
     *  row's own shots, resolved in sequence" once `count` itself is already known.
     *
     *  `reportOffset` is where this volley's OWN first shot lands in `shotStats`/the returned
     *  `SequenceStepResult.shots[]` (absolute-position-indexed, `shotStats.length` = this row's
     *  overall max shot count). For a normal branch that's always 0 (shot 1 IS absolute shot 1).
     *  For a `partialInjections` branch there's no single true absolute position (different
     *  original ROF branches can reach the SAME `shotsRemaining` at different absolute shot
     *  indices) - it's reported as if resuming at the position that leaves exactly this many shots
     *  before the row's own maximum possible count ends, i.e. `shotStats.length - count`. This is a
     *  reporting simplification only (which `shots[]` ROW a mid-volley handoff's stats land in) -
     *  it never affects `shotsRemainingAfter`, `shotsValue`, or `destroyedByShotsRemaining` below,
     *  which stay exactly correct regardless of `reportOffset`. */
    const resolveVolley = (initial: Map<string, { state: FwdState; probability: number }>, count: number, reportOffset: number): void => {
      let current = initial;
      for (let i = 1; i <= count; i++) {
        const entry = shotStats[reportOffset + i - 1];
        for (const { probability } of current.values()) entry.occursMass += probability;

        const shotsRemainingAfter = count - i;
        const isLastShot = i === count;
        const shredCache = new Map<string, number>();
        const survivors = new Map<string, { state: FwdState; probability: number }>();
        const valueAt: ExtendedValueLookup = (b, d, f, fu, sg, sc, m, o, dk, afl, sus) => shotsValue(shotsRemainingAfter, d, b, f, fu, sg, sc, m, o, dk, afl, sus);

        for (const { state, probability } of current.values()) {
          resolveAttackChainForward(
            ctx,
            k,
            atk,
            state.debuffState,
            state.boxes,
            state.focusLeft,
            state.furyLeft,
            state.shieldGuardsLeft,
            state.scapegoatsLeft,
            state.pmMask,
            state.kotdOffLeft,
            state.kotdDefLeft,
            state.attackerFocusLeft,
            shotsRemainingAfter,
            state.sustained,
            probability,
            valueAt,
            shredCache,
            entry,
            isLastShot ? next : survivors,
            destroyedByShotsRemaining[shotsRemainingAfter]
          );
        }

        current = survivors;
      }
    };

    for (const { count, probability: rofP } of rofOutcomes(atk)) {
      // `initialDist` is the PREVIOUS row's own ending distribution (plus any fresh mass injected
      // right before this row for a newly-engaged target - see computeSequenceOdds) - `sustained`
      // must never carry forward into a new row's volley, so every copied state is reset to
      // `sustained: false` here, regardless of what it was (see the module doc comment's
      // "Sustained Attack" section).
      const current = new Map<string, { state: FwdState; probability: number }>();
      for (const { state, probability } of initialDist.values()) {
        const p = probability * rofP;
        if (p <= 0) continue;
        const freshState: FwdState = { ...state, sustained: false };
        const key = fwdKey(freshState);
        const existing = current.get(key);
        if (existing) existing.probability += p;
        else current.set(key, { state: freshState, probability: p });
      }
      resolveVolley(current, count, 0);
    }

    // Mid-volley handoff from an earlier target's own destroyed mass (see the module doc comment's
    // "Multiple targets" section): each entry resumes THIS row's own weapon with a FIXED,
    // already-known shot count (no fresh ROF roll - `RowInjection`'s own doc comment explains why),
    // starting from a completely fresh state (full boxes, no debuffs, full resources) rather than
    // `initialDist` (which is mass already alive from earlier rows of THIS target's own fight -
    // irrelevant to a target that's only just now coming under fire).
    for (const { shotsRemaining, probability, attackerFocusRemaining } of partialInjections) {
      if (probability <= 0 || shotsRemaining <= 0) continue;
      const state = attackerFocusRemaining ? freshStateWithFocus(attackerFocusRemaining) : initialState;
      resolveVolley(new Map([[fwdKey(state), { state, probability }]]), shotsRemaining, shotStats.length - shotsRemaining);
    }
  }

  /**
   * Forward-simulation counterpart of `buildBoughtAttacksValue`: replays the SAME "buy or stop, and
   * with which weapon" policy the backward pass computed, for the mass now sitting in `dist` (this
   * attacker's own last configured row has just fully resolved). A bought attack's own destroy mass
   * is folded into `destroyedByShotsRemaining[0]` by the caller (the same bucket a normal
   * last-shot kill uses - see multi-target.ts's own `RowInjection` handoff, which only
   * distinguishes "died on this row's own last shot" from "died mid-volley"; a bought attack always
   * happens after the volley's very last shot). Bought attacks aren't reported as their own
   * `SequenceStepResult`/shot entries (see the module doc comment's UI/reporting gap note) - this
   * only needs `dist` itself to come out correct (boxes/debuffState/every resource, post-buying) so
   * the next real row's own forward step starts from the right distribution. Mirrors
   * `resolveAttackChainForward`'s own depth-loop shape (merge states by key per level BEFORE
   * resolving the next one, not per-branch recursion), looping over "this attacker's own remaining
   * Focus" instead of Critical Shred depth - each state independently stops once IT runs out of
   * Focus or the "stop" candidate wins for it, so different branches can buy different amounts.
   */
  function resolveBoughtAttacksForward(
    attackerIndex: number,
    dist: Map<string, { state: FwdState; probability: number }>,
    valueAt: ExtendedValueLookup,
    stopValueAt: ExtendedValueLookup
  ): { dist: Map<string, { state: FwdState; probability: number }>; destroyed: DestroyedAccumulator } {
    const slot = ctx.focusIndexOf.get(attackerIndex)!;
    const candidateWeapons = (ctx.attackIndicesByAttacker.get(attackerIndex) ?? []).filter((w) => attacks[w].type === 'melee');
    const destroyed: DestroyedAccumulator = { mass: 0, byFocus: new Map() };
    const result = new Map<string, { state: FwdState; probability: number }>();
    let current = dist;

    while (current.size > 0) {
      const continuing = new Map<string, { state: FwdState; probability: number }>();

      for (const { state, probability: p0 } of current.values()) {
        if (p0 <= 0) continue;

        const stopValue = stopValueAt(
          state.boxes, state.debuffState, state.focusLeft, state.furyLeft, state.shieldGuardsLeft, state.scapegoatsLeft,
          state.pmMask, state.kotdOffLeft, state.kotdDefLeft, state.attackerFocusLeft, false
        );

        let bestWeapon = -1;
        let bestValue = stopValue;
        if (state.attackerFocusLeft[slot] > 0) {
          const spentFocusLeft = state.attackerFocusLeft.slice();
          spentFocusLeft[slot] -= 1;
          for (const w of candidateWeapons) {
            // A fresh cache per weapon here (not shared across the loop, and not the same cache
            // `resolveAttackChainForward` uses below for the actually-chosen weapon) - reusing one
            // cache across DIFFERENT weapons would let one weapon's cached value get silently
            // returned for a different weapon's query, since `attackChainValue`'s own cache key
            // doesn't include `k`/the weapon index (see `buildBoughtAttacksValue`'s own doc comment
            // for why that's normally safe and why it wouldn't be here).
            const value = attackChainValue(
              ctx, w, attacks[w], state.debuffState, state.boxes, state.focusLeft, state.furyLeft, state.shieldGuardsLeft, state.scapegoatsLeft,
              state.pmMask, state.kotdOffLeft, state.kotdDefLeft, spentFocusLeft, 0, false, MAX_SHRED_DEPTH, valueAt, new Map<string, number>()
            );
            if (value < bestValue) {
              bestValue = value;
              bestWeapon = w;
            }
          }
        }

        if (bestWeapon === -1) {
          const key = fwdKey(state);
          const existing = result.get(key);
          if (existing) existing.probability += p0;
          else result.set(key, { state, probability: p0 });
          continue;
        }

        recordFocusPolicy(ctx, attackerIndex, state.debuffState, 'buyMass', p0);

        const spentFocusLeft = state.attackerFocusLeft.slice();
        spentFocusLeft[slot] -= 1;
        const shredCache = new Map<string, number>();
        const boughtStats: ShotStats = { hitMass: 0, critMass: 0, damageMass: 0, occursMass: 0 };
        resolveAttackChainForward(
          ctx, bestWeapon, attacks[bestWeapon], state.debuffState, state.boxes, state.focusLeft, state.furyLeft, state.shieldGuardsLeft, state.scapegoatsLeft,
          state.pmMask, state.kotdOffLeft, state.kotdDefLeft, spentFocusLeft, 0, false, p0, valueAt, shredCache, boughtStats, continuing, destroyed
        );
      }

      current = continuing;
    }

    return { dist: result, destroyed };
  }

  // --- Forward simulation, replaying the policy above to get step-by-step stats ---
  // `dist` starts EMPTY (not pre-seeded with probability 1) - all of a target's mass, including
  // today's default single-target case, enters exclusively through the `injection` mechanism below
  // (defaulting to `[{ row: 0, shotsRemaining: 0, probability: 1 }]`, i.e. "100% fresh before row
  // 0" - see the module doc comment's "Multiple targets" section). Seeding it here TOO would
  // double-count that same mass once row 0's own injection merge runs.
  let dist = new Map<string, { state: FwdState; probability: number }>();
  const initialDebuffs = startsKnockedDown ? { ...INITIAL_DEBUFFS, knockedDown: true } : INITIAL_DEBUFFS;
  // Every "enter fresh" state (target 0's own default injection, a later multi-target target's own
  // fresh-row entry, or a mid-volley resume's own starting point) shares this SAME shape except for
  // `attackerFocusLeft` - see `freshStateWithFocus`, which an injection's own `attackerFocusRemaining`
  // (carried forward from an earlier target - see RowInjection's doc comment) can override.
  const freshStateWithFocus = (attackerFocusLeft: number[]): FwdState => ({
    boxes: initialBoxes,
    debuffState: initialDebuffs,
    focusLeft: maxFocus,
    furyLeft: maxFury,
    shieldGuardsLeft: maxShieldGuards,
    scapegoatsLeft: maxScapegoats,
    pmMask: 0,
    kotdOffLeft: maxKotdOff,
    kotdDefLeft: maxKotdDef,
    attackerFocusLeft,
    sustained: false,
  });
  const initialState = freshStateWithFocus(initialAttackerFocus);

  const steps: SequenceStepResult[] = [];
  let cumulativeDestroy = 0;
  const postSequenceBuyingDestroyMass: { attackerFocusRemaining: number[]; probability: number }[] = [];

  for (let k = 0; k < n; k++) {
    const atk = attacks[k];

    if (!rowActive[k]) {
      // No-op row for this target (see the module doc comment's "Multiple targets" section) -
      // `dist` passes through unchanged, contributing no shots and no destroy chance.
      const expectedBoxesRemaining = [...dist.values()].reduce((acc, { state, probability }) => acc + state.boxes * probability, 0);
      steps.push({
        attack: atk,
        shots: [],
        destroyChanceAtThisStep: 0,
        cumulativeDestroyChance: cumulativeDestroy,
        expectedBoxesRemaining,
        destroyChanceByShotsRemaining: [],
        destroyMassByShotsRemainingAndFocus: [],
      });
      onProgress?.((k + 1) / n);
      continue;
    }

    const shotsValue = shotsValueByAttack[k];
    const maxShots = Math.max(...rofOutcomes(atk).map((o) => o.count));

    // Fresh mass ("enter this row completely fresh, roll its own ROF count") merges into the SAME
    // mass `dist` already carries forward from earlier rows before the normal per-K-branch split;
    // a mid-volley resume ("this many of this row's own shots still owed, no fresh ROF roll") is
    // handled separately inside resolveRofAttackForward - see RowInjection's doc comment.
    const rowInjections = injectionsByRow.get(k) ?? [];
    const freshInjections = rowInjections.filter((inj) => inj.shotsRemaining === 0);
    const partialInjections = rowInjections.filter((inj) => inj.shotsRemaining > 0);
    const freshInjectedMass = freshInjections.reduce((sum, inj) => sum + inj.probability, 0);

    const enteringDist = new Map(dist);
    // Grouped by `attackerFocusRemaining` (defaulting to this call's own configured
    // `initialAttackerFocus`) rather than summed into one blob - two fresh-entry injections can
    // carry DIFFERENT Focus remaining (mass that reached this target via different earlier-target
    // branches), each needing its own distinct starting `FwdState` - see RowInjection's doc comment.
    for (const inj of freshInjections) {
      if (inj.probability <= 0) continue;
      const state = inj.attackerFocusRemaining ? freshStateWithFocus(inj.attackerFocusRemaining) : initialState;
      const key = fwdKey(state);
      const existing = enteringDist.get(key);
      enteringDist.set(key, { state, probability: (existing?.probability ?? 0) + inj.probability });
    }

    const next = new Map<string, { state: FwdState; probability: number }>();
    const shotStats: ShotStats[] = Array.from({ length: maxShots }, () => ({ hitMass: 0, critMass: 0, damageMass: 0, occursMass: 0 }));
    const destroyedByShotsRemaining: DestroyedAccumulator[] = Array.from({ length: maxShots }, () => ({ mass: 0, byFocus: new Map() }));
    // Includes `partialInjections`' own mass too, even though it never enters `enteringDist` (it
    // resolves via its own synthetic branches inside resolveRofAttackForward, not the normal
    // rofOutcomes split) - otherwise a row entered ENTIRELY via a mid-volley handoff would divide
    // occursChance by zero alive mass despite 100% of this target's mass genuinely being present.
    let aliveMass = 0;
    for (const { probability } of enteringDist.values()) aliveMass += probability;
    for (const { probability } of partialInjections) aliveMass += probability;

    resolveRofAttackForward(k, atk, enteringDist, shotsValue, shotStats, destroyedByShotsRemaining, next, partialInjections);

    const attackerIdx = atk.attackerIndex ?? 0;
    const boughtLookups = boughtAttacksValueAtByAttacker.get(attackerIdx);
    let afterBuying = next;
    if (boughtLookups && isLastAttackOfAttackerForFocus(ctx, k, atk)) {
      const bought = resolveBoughtAttacksForward(attackerIdx, next, boughtLookups.valueAt, boughtLookups.stopValueAt);
      afterBuying = bought.dist;
      mergeDestroyed(destroyedByShotsRemaining[0], bought.destroyed);
    }

    const destroyChanceAtThisStep = destroyedByShotsRemaining.reduce((sum, d) => sum + d.mass, 0);
    cumulativeDestroy += destroyChanceAtThisStep;
    dist = afterBuying;

    const expectedBoxesRemaining = [...dist.values()].reduce(
      (acc, { state, probability }) => acc + state.boxes * probability,
      0
    );

    const shots: SequenceShotResult[] = shotStats.map((s) => ({
      occursChance: aliveMass > 0 ? s.occursMass / aliveMass : 0,
      hitChance: s.occursMass > 0 ? s.hitMass / s.occursMass : 0,
      critChance: s.occursMass > 0 ? s.critMass / s.occursMass : 0,
      averageDamage: s.occursMass > 0 ? s.damageMass / s.occursMass : 0,
    }));

    const destroyMassByShotsRemainingAndFocus: { shotsRemaining: number; attackerFocusRemaining: number[]; probability: number }[] = [];
    destroyedByShotsRemaining.forEach((d, shotsRemaining) => {
      for (const { attackerFocusRemaining, mass } of d.byFocus.values()) {
        destroyMassByShotsRemainingAndFocus.push({ shotsRemaining, attackerFocusRemaining, probability: mass });
      }
    });

    steps.push({
      attack: atk,
      shots,
      destroyChanceAtThisStep,
      cumulativeDestroyChance: cumulativeDestroy,
      expectedBoxesRemaining,
      destroyChanceByShotsRemaining: destroyedByShotsRemaining.map((d) => d.mass),
      destroyMassByShotsRemainingAndFocus,
    });

    onProgress?.((k + 1) / n);
  }

  // `RowInjection.row === n` mass (see `terminalBoughtLookups` above): an attacker who already
  // exhausted every configured row against an EARLIER multi-target target, but still has Focus left
  // over, entering THIS target completely fresh - not "row 0 fresh" (that would let every OTHER
  // row fire again, which is wrong, every row already had its turn), just this attacker's own
  // remaining Focus getting one more chance to buy attacks here. A no-op whenever no such injection
  // exists (every existing single-target call, and every multi-target call with no Focus active).
  const rowNInjections = injectionsByRow.get(n) ?? [];
  if (rowNInjections.length > 0) {
    let postBuyingDist = new Map<string, { state: FwdState; probability: number }>();
    for (const inj of rowNInjections) {
      if (inj.probability <= 0) continue;
      const state = freshStateWithFocus(inj.attackerFocusRemaining ?? initialAttackerFocus);
      const key = fwdKey(state);
      const existing = postBuyingDist.get(key);
      if (existing) existing.probability += inj.probability;
      else postBuyingDist.set(key, { state, probability: inj.probability });
    }
    for (const attackerIdx of [...ctx.focusIndexOf.keys()].sort((a, b) => a - b)) {
      const lookups = terminalBoughtLookups.get(attackerIdx)!;
      const bought = resolveBoughtAttacksForward(attackerIdx, postBuyingDist, lookups.valueAt, lookups.stopValueAt);
      postBuyingDist = bought.dist;
      for (const { attackerFocusRemaining, mass } of bought.destroyed.byFocus.values()) {
        postSequenceBuyingDestroyMass.push({ attackerFocusRemaining, probability: mass });
      }
      cumulativeDestroy += bought.destroyed.mass;
    }
    for (const { state, probability } of postBuyingDist.values()) {
      const key = fwdKey(state);
      const existing = dist.get(key);
      if (existing) existing.probability += probability;
      else dist.set(key, { state, probability });
    }
  }

  const survivalByBoxes = new Map<number, number>();
  for (const { state, probability } of dist.values()) {
    survivalByBoxes.set(state.boxes, (survivalByBoxes.get(state.boxes) ?? 0) + probability);
  }
  const survivalDistribution = [...survivalByBoxes.entries()]
    .map(([boxes, probability]) => ({ boxes, probability }))
    .sort((a, b) => a.boxes - b.boxes);

  // Seeded from `focusIndexOf` (every Focus-enabled attacker), not just `focusPolicyLog`'s own
  // recorded events - an attacker whose true-optimal policy never once found spending worthwhile
  // (see `summarizeFocusStrategy`'s "rarely worth it" fallback) would otherwise be silently
  // indistinguishable from an attacker with no Focus configured at all.
  const focusStrategy: FocusStrategyEntry[] = [...focusIndexOf.keys()].map((attackerIndex) => {
    const bySituation = ctx.focusPolicyLog?.byAttackerAndSituation.get(attackerIndex);
    return { attackerIndex, healthy: bySituation?.get('healthy'), debuffed: bySituation?.get('debuffed') };
  });

  return { steps, finalDestroyChance: cumulativeDestroy, survivalDistribution, focusStrategy, postSequenceBuyingDestroyMass };
}

/** How much of a situation's own strongest action's mass a SECOND (or third) action needs before
 *  it's worth mentioning too - see `summarizeFocusStrategy`'s own doc comment for why this can't be
 *  "pick the single biggest one": the three tallies are NOT a mutually-exclusive partition (a boost-
 *  attack-roll decision and a boost-damage-roll decision on that SAME roll, or a boost decision on a
 *  configured attack followed by a buy decision once it's done, routinely both fire for the SAME
 *  underlying probability mass) - a 50%-of-the-max threshold is a readable, if inexact, stand-in for
 *  "clearly part of the real strategy" without needing to reconstruct the exact joint mass. */
const SIGNIFICANT_ACTION_RATIO = 0.5;

/**
 * Turns one attacker's own `FocusStrategyEntry` (raw, probability-weighted tallies recorded during
 * the forward replay - see `recordFocusPolicy`) into a short, player-facing sentence describing the
 * true-optimal Focus policy actually computed - branching by target condition when the computed
 * policy itself branches (mirrors the kind of advice a player would expect: "boost attack rolls
 * until the target is Knocked Down, then boost damage rolls"), never a hand-authored heuristic or
 * raw numbers. `attackerName` resolves a display name for `entry.attackerIndex` - the engine itself
 * has no notion of attacker names, only the UI layer does. Data-driven, not template-hardcoded
 * advice: which action(s) dominate (and whether the policy branches by situation at all) is read
 * directly off whatever `computeSequenceOdds` actually decided for THIS specific attacker/weapon/
 * target combination, so two different setups can legitimately produce different summaries.
 *
 * `boostAttackMass`/`boostDamageMass`/`buyMass` are recorded independently at three SEPARATE
 * decision points (see `recordFocusPolicy`'s own call sites) - they are NOT alternatives competing
 * for the same probability mass the way an earlier version of this function assumed (picking a
 * single "dominant" action and discarding the rest). With only a couple of Focus points and a
 * single hard-to-hit roll, for instance, the true-optimal policy routinely spends BOTH a boosted
 * attack roll AND a boosted damage roll on that SAME roll - reporting only the larger of the two
 * would silently drop half of the real strategy. `significantActions` below lists every action
 * whose own mass is at least `SIGNIFICANT_ACTION_RATIO` of that situation's strongest action,
 * ordered the way the pipeline itself decides them (boost attack roll, outermost, first; boost
 * damage roll, mid-pipeline, second; buy, only after every configured attack, last).
 */
export function summarizeFocusStrategy(entry: FocusStrategyEntry, attackerName: string): string {
  type Action = 'boostAttack' | 'boostDamage' | 'buy';
  const significantActions = (tally?: { boostAttackMass: number; boostDamageMass: number; buyMass: number }): Action[] => {
    if (!tally) return [];
    const { boostAttackMass, boostDamageMass, buyMass } = tally;
    const strongest = Math.max(boostAttackMass, boostDamageMass, buyMass);
    if (strongest <= 0) return [];
    const threshold = strongest * SIGNIFICANT_ACTION_RATIO;
    const actions: Action[] = [];
    if (boostAttackMass >= threshold) actions.push('boostAttack');
    if (boostDamageMass >= threshold) actions.push('boostDamage');
    if (buyMass >= threshold) actions.push('buy');
    return actions;
  };
  const phraseFor = (actions: Action[]): string => {
    const boostedRolls: string[] = [];
    if (actions.includes('boostAttack')) boostedRolls.push('attack');
    if (actions.includes('boostDamage')) boostedRolls.push('damage');
    const phrases: string[] = [];
    if (boostedRolls.length > 0) phrases.push(`boost ${boostedRolls.join(' and ')} rolls`);
    if (actions.includes('buy')) phrases.push('buy extra attacks');
    if (phrases.length <= 1) return phrases[0] ?? '';
    return phrases.length === 2 ? phrases.join(' and ') : `${phrases.slice(0, -1).join(', ')}, and ${phrases.at(-1)}`;
  };

  const healthyPhrase = phraseFor(significantActions(entry.healthy));
  const debuffedPhrase = phraseFor(significantActions(entry.debuffed));

  if (!healthyPhrase && !debuffedPhrase) {
    return `${attackerName} rarely finds it worth spending Focus here.`;
  }
  if (healthyPhrase && debuffedPhrase && healthyPhrase !== debuffedPhrase) {
    return `${attackerName}: ${healthyPhrase} until the target is Knocked Down, then ${debuffedPhrase}.`;
  }
  return `${attackerName}: ${healthyPhrase || debuffedPhrase} whenever Focus is available.`;
}
