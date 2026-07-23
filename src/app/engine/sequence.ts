/**
 * sequence.ts
 * -----------
 * A full attack sequence: any number of attackers, each with any number of
 * attacks, applied IN ORDER against a single shared target. This is the
 * "assassination run" calculation - e.g. "will these 10 attacks combined
 * destroy that warjack?"
 *
 * The target may also have Focus and/or Fury points to spend defensively:
 * once per attack, after damage is rolled, it may spend one point (focus OR
 * fury, never both) to reduce or negate that hit - see `bestAction` below.
 * We assume the target always spends optimally, which requires looking
 * AHEAD at the rest of the sequence (a point saved now might matter more
 * later), not just reacting to the current hit. That's computed by backward
 * induction (`valueTables`) before replaying the decisions forward to get
 * the step-by-step numbers the UI shows.
 *
 * On top of that, attacks can inflict PERSISTENT debuffs on the target
 * (Knockdown, Stationary, Ice Cage, Shadowbind, Blind, Paralysis, Flare,
 * Weaken, a generic ARM debuff, Dispel) that change its DEF/ARM for the REST
 * of the sequence - see `DebuffState` below. These evolve independently of
 * the Focus/Fury sub-problem (spending a resource point never changes
 * DEF/ARM), but they do interact at two points: surviving a Tough roll
 * always also knocks the target down, and a Knocked Down/Stationary target
 * can't attempt a plain Tough roll at all (Tough Steady is immune to that
 * second coupling - see `damageBranches`).
 *
 * The target can also carry static, sequence-wide bonuses - Shield/Unyielding/
 * Carapace/generic spell bonuses - resolved once per attack context in
 * `profileFor`, same as the printed DEF/ARM stats they sit on top of. Some of
 * these are spell-granted rather than innate to the model, which is why each
 * one comes in a PRE-Dispel/POST-Dispel pair (`SequenceTarget.spellArmBonus`/
 * `spellArmBonusPostDispel`, `unyielding`/`unyieldingPostDispel`, etc.) -
 * `profileFor` picks whichever half of the pair matches `debuffState.dispelled`.
 * Two more per-attack toggles narrow which of these a SPECIFIC attack sees at
 * all, regardless of Dispel: Blessed (`SequencedAttack.blessed`) ignores every
 * Stat-type spell bonus, and Chain Weapon (`SequencedAttack.chainWeapon`)
 * ignores Shield's ARM bonus - see `profileFor`.
 *
 * Rapid Healing (`SequenceTarget.rapidHealing`) adds a THIRD sub-problem on top of Focus/Fury and
 * the persistent debuffs: after any hit that deals nonzero RAW damage and doesn't destroy the
 * target (Tough already resolved), the target rolls a d3 and heals that many boxes, capped at its
 * starting box count - see `healBranches`. "Raw" matters here: whether Rapid Healing triggers is
 * decided by the damage the attack dealt BEFORE any Focus/Fury mitigation, not by how much of it
 * actually reached the target's boxes - spending a resource point to blunt or fully negate a hit
 * doesn't undo the fact that the target was hit, it just softens the consequence, so `bestAction`
 * carries that original value alongside whichever mitigated amount a given candidate action
 * produces. Grievous Wounds (a `StatEffectType`, like Dispel a `DebuffState` flag) turns Rapid
 * Healing off for the rest of the sequence once inflicted, and also removes Tough/Tough Steady
 * entirely (on top of the existing Knocked Down/Stationary negation, which only ever affected
 * plain Tough) - see `damageBranches`.
 *
 * Critical Shred (`SequencedAttack.criticalShred`) is the odd one out architecturally: every other
 * effect only ever changes DEF/ARM/boxes/debuffs for a FIXED, known-in-advance sequence of
 * attacks. Shred means a crit makes this SAME attack fire again, immediately, against whatever
 * state resulted from the first (which can itself crit and fire again...) - so the number of dice
 * rolls "at position k" becomes a random variable, not a constant. This is modeled as a small
 * self-referential value problem local to position k: `attackChainValue` (backward induction) and
 * `resolveAttackChainForward` (forward simulation) both resolve one attack instance and, on a
 * crit with Shred active, recurse into ANOTHER instance of themselves instead of falling through
 * to the next attack - up to `MAX_SHRED_DEPTH` instances deep, since each further instance
 * requires another crit and therefore contributes probability that shrinks geometrically
 * (`critChance^depth`); truncating there leaves an error far below floating-point-visible
 * precision for any realistic crit chance, the same kind of documented simplification as Tough's
 * "no once-per-turn limit". A Shred chain can trigger the SAME crit-only persistent effect (Ice
 * Cage, "-X ARM") repeatedly, once per instance in the chain - `getValueTableAt` (see "Lazy value
 * tables" below) needs no special handling for this: whatever `DebuffState` a real chain instance
 * actually produces gets its own value table built on first request, regardless of how many
 * repeated crit applications it took to reach. In the step-by-step breakdown, "Avg
 * damage" is the TOTAL expected damage across a whole chain (what actually happens at that
 * position), but "Hit"/"Crit" chance stay the ORIGINAL roll's own - a single well-defined
 * probability, unlike "average damage" which stays meaningful however many rolls occurred.
 *
 * Rate of Fire (`SequencedAttack.rof`, ranged-only) fires MULTIPLE independent shots against the
 * target instead of just one - the shot count is decided ONCE via a die roll before any of this
 * attack's own dice are thrown, unlike Critical Shred's per-instance crit-triggered recursion: by
 * the time the target is deciding whether to spend Focus/Fury on shot i, it already knows the
 * total shot count K for the whole volley (common knowledge the moment the attacker rolls ROF,
 * before any attack/damage dice), not merely an average over an unknown future. That's why
 * `buildShotsValue`'s backward-induction helper builds one memoized value function PER POSSIBLE
 * "shots remaining" count, rather than folding ROF into a single blended lookahead the way a
 * crit-triggered continuation could: `shotsValue(s, ...)` is "resolve one more shot of this same
 * attack (itself already Shred-aware via `attackChainValue`), then `shotsValue(s-1, ...)`
 * afterward", bottoming out at `shotsValue(0, ...)` = the ordinary "attacks k+1 onward" value. The
 * forward simulation (`resolveRofAttackForward`) mirrors this exactly, per possible shot count K:
 * splits the incoming probability mass by `rofOutcomes`, then resolves K shots in sequence within
 * each K-branch, reusing the SAME `shotsValue` functions the backward pass built so the replayed
 * Focus/Fury policy matches what was actually optimized for. Like Shred, "Hit"/"Crit" chance in
 * the step-by-step breakdown stay the FIRST shot's own well-defined probability (identical across
 * every possible K, since K is independent of any attack dice), while "Avg damage" sums every shot
 * actually fired, across every K, weighted by its own probability.
 *
 * Puppet Master (`SequencedAttack.hasPuppetMaster`, one bit per distinct `attackerIndex` with it
 * active - see `pmMask` below) grants ONE ATTACKER a single shared reroll token, spendable once on
 * ANY of that attacker's own attack or damage rolls, across every attack it makes. Deliberately
 * modeled as a FIXED, mechanical rule rather than an omniscient-optimal spend (unlike Focus/Fury):
 * an optimal spend would let the app claim a higher destroy chance than a real player, who doesn't
 * know in advance which roll the token would be "best" saved for, could actually achieve. The rule
 * (`resolvePmSplit`), walking this attacker's own rolls in order while the token is still unspent:
 *   1. A roll with a genuine to-hit chance (not auto-hit): reroll it if it would MISS - "the first
 *      missed attack roll". If it hits, the token stays unspent and carries forward untouched.
 *   2. A roll that's auto-hit (no to-hit roll to miss) only gets a DAMAGE-roll check instead - and
 *      only once it's clear waiting longer serves no purpose: EITHER every one of this attacker's
 *      REMAINING attacks is guaranteed auto-hit too (so rule 1 can structurally never fire again),
 *      OR this is this attacker's LAST attack (so there's no later roll to save the token for
 *      either way). Below that point, reroll the damage roll if it's below average; otherwise the
 *      token carries forward unspent (there's nothing to gain from spending it here).
 *   3. The SAME damage-roll check ALSO applies to a non-auto-hit roll's damage, but only as a
 *      second chance on a roll that already passed rule 1 (hit normally) while ALSO satisfying
 *      rule 2's "nothing left to wait for" condition (same OR: guaranteed-auto-hit-for-the-rest, or
 *      this is the last attack) - otherwise a hit that isn't the last opportunity just moves on,
 *      preserving the token for a later roll that might still miss.
 * If the token is still unspent after the attacker's last attack, it goes unused - by design (see
 * point 1 above): the app doesn't get to pretend a resource a real player might genuinely never
 * find a good use for was spent anyway.
 *
 * Since "will every remaining attack of mine inevitably auto-hit" only ever depends on information
 * ALREADY known at this point in a given branch (Knocked Down/Stationary, once inflicted, never
 * clears - see `DebuffState` - and `forceAutoHit`/`type` are static per attack), this is a genuine
 * forward-only, no-lookahead rule: `resolvePmSplit` never needs to peek at how any LATER roll
 * happens to turn out, only at the CURRENT debuff state plus the attacker's own static attack list
 * (`isAutoHitGuaranteedForRest`/`isLastAttackOfAttacker`).
 *
 * A "reroll" here is mathematically just an i.i.d. redraw from the SAME pool the original roll came
 * from - so `resolvePmSplit` never needs to build a genuinely NEW profile for the "rerolled" case:
 * a miss's own reroll is, by construction, the SAME to-hit distribution the miss itself was drawn
 * from (see the file header's Reroll note); a below-average damage roll's own reroll is likewise
 * exactly `splitAttackDamageForPuppetMaster`'s full, unconditional distribution again. What
 * `resolvePmSplit` actually returns is a small SET of `(profile, resultingMask)` populations that
 * ALL genuinely happen (each already correctly pre-scaled to its own share of the roll) - e.g. "hit
 * normally, mass = hitChance, mask unchanged" plus "missed then rerolled, mass = missChance, mask
 * now spent" - which the caller just sums over like any other outcome, no comparison/decision
 * needed at that point (contrast this with `bestAction`'s genuine 3-way comparison for Focus/Fury,
 * which Puppet Master never needed in the first place, being a fixed rule rather than a choice).
 *
 * `pmMask` still threads through the SAME grid Focus/Fury already occupies (`boxes/focus/fury`), as
 * one more small, densely-enumerated dimension (folded into the `Map<string, ValueTable>` key
 * alongside `DebuffState`, not a new `ValueTable` array axis - see `tableKey`) - NOT into
 * `bestAction`/`ValueTable`/`ValueLookup` themselves, which stay entirely unaware Puppet Master
 * exists: the mask only ever changes ONCE, atomically, at the point `resolvePmSplit` builds each
 * population, strictly BEFORE that population's own outcomes are enumerated - by the time
 * `bestAction` runs, whether the token was just spent is already baked into which profile produced
 * the outcome it's reacting to, exactly like the row's own `rerollAttack`/`rerollDamage` toggles
 * are baked into a profile before `bestAction` ever sees it. This still has to live one level ABOVE
 * `bestAction` (the SAME level `attackChainValue` already resolves Shred's recursion and
 * `buildShotsValue` already resolves ROF's per-shot lookahead at) purely because Focus/Fury's OWN
 * optimal spending needs to know, in advance, which profile a LATER roll will actually draw from -
 * which is exactly why the token is independently re-checked at every Shred instance and every ROF
 * shot, not just an attack's first roll: both already thread their own state through
 * `attackChainValue` the same way `pmMask` does.
 *
 * Knowledge of the Damned (`SequenceTarget.offensiveKnowledgeOfTheDamned`/
 * `defensiveKnowledgeOfTheDamned`, `kotdOffLeft`/`kotdDefLeft`) is TWO more reroll-granting
 * resources, both living on the TARGET (unlike Puppet Master, which is per-attacker) and shared
 * across EVERY attacker in the sequence - a pool of 0-10 charges each, not a single token.
 *
 * Offensive Knowledge of the Damned is, mechanically, Puppet Master generalized from "1 token,
 * scoped to one attacker" to "N pooled charges, shared globally" - same fixed, no-lookahead rule
 * (`resolveKotdOffSplit`): reroll any missed attack roll unconditionally; reroll a below-average
 * damage roll only once it's SAFE to (the "reserve rule" - `damageRerollEligibleForOffKotd`):
 * eligible only when the charges that would remain afterward are enough to cover
 * `remainingMissableRollCount` - every remaining roll, system-wide across every attacker, that
 * could still miss. This collapses EXACTLY onto Puppet Master's own rule when `kotdOffLeft` is 1
 * (the only way `charges - 1 >= remainingCount` can hold with 1 charge is `remainingCount === 0`,
 * i.e. nothing left to miss - Puppet Master's exact condition). A Rate of Fire attack's OWN
 * remaining shots count exactly (`shotsRemainingThisRow`, already known once inside that row's own
 * volley - see the Rate of Fire section above); a LATER row's own ROF shot count isn't decided yet
 * at evaluation time, so its worst case (`maxShots`) is used as a safe upper bound. A Critical
 * Shred-active row is deliberately NOT expanded into multiple units, matching
 * `isAutoHitGuaranteedForRest`'s own row-level treatment.
 *
 * Defensive Knowledge of the Damned is architecturally the new piece: the TARGET'S genuinely
 * OPTIMAL choice (full sequence lookahead, exactly like Focus/Fury's own assumption) of whether to
 * force a reroll of EITHER the attack roll (if it's currently a hit) or the damage roll (if it's
 * currently above average) - whichever lowers the destroy chance more, or neither
 * (`resolveKotdDefChoice`). Unlike Focus/Fury (which only ever transforms a single already-REALIZED
 * damage number, post-hoc, inside `bestAction`), a reroll changes the underlying DICE - so this has
 * to live at the SAME profile level Puppet Master/Offensive Knowledge of the Damned already operate
 * at, comparing whole-profile candidates via `profileScore` (a new helper that aggregates
 * `bestAction`'s own `outcomeScore`/`isBetterScore` lexicographic comparison across every outcome a
 * candidate profile can produce, not just one) rather than `bestAction`'s own single-outcome
 * comparison.
 *
 * Both share a KEY principle with Puppet Master, made explicit now that THREE reroll stages can
 * apply to the same roll in sequence: a "reroll" is always an i.i.d. redraw from the roll's TRUE,
 * fully unconditional distribution (`trueOriginal = profileFor(k, atk, debuffState)`, computed ONCE
 * per roll and shared by every stage) - never from whatever partially-conditioned profile an
 * upstream stage happens to be holding (`inputProfile`). These two profiles are only identical for
 * Puppet Master (the first stage); every function below Puppet Master's own level takes BOTH
 * explicitly. The full pipeline, run once per roll inside `attackChainValue`: the row's own
 * `reroll` toggle (baked in by `buildAttackProfile` already) -> Puppet Master (`resolvePmSplit`,
 * per-attacker, fixed) -> Offensive Knowledge of the Damned (`resolveKotdOffSplit`, global, fixed)
 * -> Defensive Knowledge of the Damned (`resolveKotdDefChoice`, global, optimal - run once per
 * Puppet-Master-population x Offensive-Knowledge-of-the-Damned-population, since its optimal choice
 * can legitimately differ per resulting resource combination). This composition is exactly what
 * makes "a roll can be rerolled once by each rule, but by both an attacker-side rule AND the
 * target's own Defensive Knowledge of the Damned" hold: each stage transforms whatever profile the
 * previous stage produced, strictly sequentially, so a given physical roll is touched by at most
 * one Puppet-Master decision, at most one Offensive-Knowledge-of-the-Damned decision, and at most
 * one Defensive-Knowledge-of-the-Damned decision - never twice by the same rule.
 *
 * `kotdOffLeft`/`kotdDefLeft` thread through the exact same grid `pmMask` already occupies
 * (`tableKey`, `ExtendedValueLookup`, `FwdState`/`fwdKey`) - `bestAction`/`ValueTable`/`ValueLookup`
 * stay entirely unaware either exists, for the same reason they stay unaware of `pmMask`.
 *
 * Performance note: we do NOT branch into one probability tree per attack
 * (that would blow up combinatorially). Instead we track a small probability
 * distribution over the target's *state* (boxes remaining, debuffs, focus/fury
 * remaining) and fold each attack into it in turn. Each attack's dice-pool
 * enumeration (the expensive part) is cached per attack and per distinct
 * (DEF, ARM, status) context it's actually resolved against - contexts are
 * few in practice (bounded by how many debuff-inflicting effects are
 * actually configured across the sequence), so this stays effectively
 * instant even for ~10 attacks. `pmMask x kotdOffLeft x kotdDefLeft` (on top of the existing
 * `focusLeft x furyLeft`) IS a genuine multiplicative state-space cost when several of these
 * resources are configured at once with large point totals - the `MAX_RESOURCE_POINTS` cap (10,
 * same as Focus/Fury) is a direct, intentional part of this feature's spec rather than a
 * pathological edge case to guard against further, so the mitigation is on the OTHER side of that
 * cap instead: `getValueTableAt` (see "Lazy value tables" below) only ever builds a table for a
 * `(debuffState, pmMask, kotdOffLeft, kotdDefLeft)` combination some real branch of the computation
 * actually reaches, rather than eagerly building the full cross product regardless of reachability -
 * a short sequence can never actually spend anywhere near 10 charges, so most of that configured
 * range is never built at all in practice, even though the cap itself stays at 10.
 */

import {
  AppliedOutcome,
  AttackEffects,
  AttackProfile,
  AttackType,
  EffectTrigger,
  RollModifiers,
  applyProfile,
  buildAttackProfile,
  splitAttackDamageByAverage,
} from './attack-model';

/** Named persistent target debuffs an attack can inflict on a hit or a crit. See doc comments on
 *  each in `docs/`. 'dispel' and 'grievousWounds' are the odd ones out - neither debuffs DEF/ARM
 *  directly ('dispel' strips currently-dispellable spell bonuses/rules, 'grievousWounds' removes
 *  Tough/Tough Steady and Rapid Healing, see `profileFor`/`damageBranches`) - but both are modeled
 *  the same way (a `DebuffState` flag that, once set, persists for the rest of the sequence) since
 *  they're exactly as "sticky" as the others. */
export type StatEffectType =
  | 'knockdown'
  | 'stationary'
  | 'iceCage'
  | 'shadowbind'
  | 'blind'
  | 'paralysis'
  | 'flare'
  | 'weaken'
  | 'armPenalty'
  | 'dispel'
  | 'grievousWounds';

export interface StatEffect {
  type: StatEffectType;
  trigger: EffectTrigger;
  /** Only meaningful for 'armPenalty' (generic "-X ARM"): how much ARM to remove. */
  amount?: number;
}

export type RofValue = '1' | 'd3' | '2d3';

export interface SequencedAttack {
  id: string;
  attackerName: string;
  label: string;
  type: AttackType;
  /** MAT for melee, RAT for ranged, RAT/spell stat for arcane. */
  stat: number;
  modifiers?: RollModifiers;
  pow: number;
  damageModifiers?: RollModifiers;
  /** Ranged-only: fires this many independent shots against the target instead of just one, the
   *  shot count decided ONCE via a die roll before any of this attack's dice are thrown (see the
   *  module doc comment's "Rate of Fire" section). Ignored for melee/arcane attacks. Unset/'1'
   *  means a single shot, same as every other attack. */
  rof?: RofValue;
  /** Effects scoped to this attack alone (Brutal Damage, Armor Piercing, Decapitation, Trash, Shatter). */
  effects?: AttackEffects;
  /** Effects that persist on the target for the rest of the sequence once triggered. */
  statEffects?: StatEffect[];
  /** Manual override: this attack automatically hits regardless of DEF (e.g. target is Stationary). */
  forceAutoHit?: boolean;
  /** This attack ignores every Stat-type spell bonus (DEF and ARM alike) on the target. */
  blessed?: boolean;
  /** This attack ignores the target's Shield ARM bonus specifically (nothing else). */
  chainWeapon?: boolean;
  /** On a critical hit, this attack fires again immediately with the same profile, against
   *  whatever state resulted from the crit - and that instance can itself crit and fire again,
   *  recursively (bounded by `MAX_SHRED_DEPTH`) - see the module doc comment. */
  criticalShred?: boolean;
  /** Stable per-computation key grouping every attack owned by the SAME attacker, for Puppet
   *  Master's shared reroll token (see `resolvePmSplit`) - deliberately NOT `attackerName`, which
   *  is a display string two different (both-unnamed) attackers can collide on. Every attack
   *  belonging to one attacker must carry the same index; unused when `hasPuppetMaster` is unset. */
  attackerIndex?: number;
  /** True on every attack belonging to an attacker with Puppet Master active - see the module doc
   *  comment's Puppet Master section and `resolvePmSplit`. */
  hasPuppetMaster?: boolean;
}

export interface SequenceTarget {
  /** Numeric DEF, or 'KD' if the target starts the whole sequence Knocked Down: melee attacks
   *  then auto-hit for the whole sequence, but ranged and arcane attacks still roll normally
   *  against a DEF of 5 (Knocked Down does not help against those). */
  def: number | 'KD';
  arm: number;
  boxes: number;
  /** A Knocked Down or Stationary target cannot attempt a Tough roll (see `isKnockedDownOrStationary`)
   *  - plain Tough is negated exactly like the tabletop rule. Mutually exclusive with `toughSteady`. */
  tough?: boolean;
  /** Like `tough`, but the roll is never negated by Knocked Down/Stationary. Mutually exclusive with `tough`. */
  toughSteady?: boolean;
  /** `tough`/`toughSteady` as they'd read if Dispel had already fired - i.e. the target's INNATE
   *  Tough/Tough Steady alone. A spell-granted Tough/Tough Steady is always Dispellable by
   *  construction (see target-panel.model.ts), so it never survives past this point; an innate one
   *  always does. `profileFor`/`damageBranches` pick this half of the pair once `DebuffState.dispelled`
   *  is true. Leave unset (defaults to `false`) if Tough/Tough Steady is never spell-granted. */
  toughPostDispel?: boolean;
  toughSteadyPostDispel?: boolean;
  toughOn?: number;
  /** Focus points the target can spend, one per attack, after damage is rolled: reduces that hit's damage by 5. */
  focusPoints?: number;
  /** Fury points the target can spend, one per attack, after damage is rolled: negates that hit's damage entirely (transferred to a warbeast). */
  furyPoints?: number;
  /** Offensive Knowledge of the Damned: a 0-10 pool of forced rerolls shared across EVERY attacker
   *  (not per-attacker like Puppet Master), spent via the same kind of fixed, no-lookahead rule
   *  Puppet Master uses - see `resolveKotdOffSplit` and the module doc comment's Knowledge of the
   *  Damned section. */
  offensiveKnowledgeOfTheDamned?: number;
  /** Defensive Knowledge of the Damned: a 0-10 pool of forced rerolls the TARGET can spend against
   *  any attacker's attack or damage roll, chosen optimally with full sequence lookahead (like
   *  Focus/Fury) - see `resolveKotdDefChoice`. */
  defensiveKnowledgeOfTheDamned?: number;
  /** Flat ARM bonus from Shield specifically (kept apart from `spellArmBonus` so Chain Weapon can
   *  ignore just this component) - added on top of `arm`, but deliberately NOT included in the
   *  "base ARM" Armor Piercing halves (see `profileFor`). Not itself Dispel-aware: a spell-granted
   *  Shield isn't reachable from the current UI, so this is always the innate capability's bonus. */
  shieldArmBonus?: number;
  /** Flat ARM bonus from every currently-active Stat-type spell (Dispellable or not) - kept apart
   *  from `shieldArmBonus` so Blessed can ignore just this component. */
  spellArmBonus?: number;
  /** Same, but counting only the spells that are NOT flagged Dispellable - what's left of
   *  `spellArmBonus` once Dispel has fired (see `toughPostDispel` for the same pattern). */
  spellArmBonusPostDispel?: number;
  /** Flat DEF bonus from every currently-active Stat-type spell (Dispellable or not). */
  defBonus?: number;
  /** Same, but counting only the spells that are NOT flagged Dispellable. */
  defBonusPostDispel?: number;
  /** +2 ARM against melee attacks specifically (innate or spell-granted). */
  unyielding?: boolean;
  /** `unyielding` as it'd read post-Dispel - see `toughPostDispel`. */
  unyieldingPostDispel?: boolean;
  /** +4 ARM against ranged attacks specifically (innate or spell-granted). */
  carapace?: boolean;
  /** `carapace` as it'd read post-Dispel - see `toughPostDispel`. */
  carapacePostDispel?: boolean;
  /** The target heals d3 boxes after any hit that deals nonzero damage without destroying it -
   *  see `healBranches`. Turned off for the rest of the sequence by Grievous Wounds (there's no
   *  Dispel-style pre/post pair here: unlike Tough/Unyielding/etc. this isn't currently reachable
   *  as a spell grant from the UI, and Grievous Wounds is a one-way switch, not a removable buff). */
  rapidHealing?: boolean;
}

export interface SequenceStepResult {
  attack: SequencedAttack;
  /** Chance to hit for this attack, conditional on the target still being alive when it's made. */
  hitChance: number;
  /** Chance of a critical hit (natural double) for this attack, conditional on the target still being alive when it's made. */
  critChance: number;
  /** Expected raw damage dealt by this attack's dice/POW/ARM (before any Focus/Fury mitigation), conditional on the target still being alive when it's made. */
  averageDamage: number;
  /** Chance the target is newly destroyed on exactly this attack (unconditional, out of the original 1.0). */
  destroyChanceAtThisStep: number;
  /** Chance the target has been destroyed by this attack or any earlier one. */
  cumulativeDestroyChance: number;
  /** Unconditional expectation of remaining boxes after this attack (destroyed counts as 0). */
  expectedBoxesRemaining: number;
}

export interface SequenceResult {
  steps: SequenceStepResult[];
  finalDestroyChance: number;
  /** Remaining-boxes distribution conditional on the target surviving the whole sequence. */
  survivalDistribution: { boxes: number; probability: number }[];
}

const MAX_RESOURCE_POINTS = 10; // far beyond any Warmachine/Hordes caster's focus/fury stat; guards the value-table size.

// Caps how many DISTINCT attackers can have Puppet Master active at once - the mask dimension
// grows as 2^(this many), same guard-rail spirit as MAX_RESOURCE_POINTS above. Realistically 0-2
// in any sequence; this just bounds the pathological case.
const MAX_PM_ATTACKERS = 8;

// Bounds how many extra instances a Critical Shred chain can recurse through. Each further
// instance requires another crit, so the untruncated tail's probability is critChance^depth -
// for any realistic crit chance this is astronomically small well before depth 10 (e.g. 0.3^10 is
// about 6e-6), the same "exact enough" tradeoff as the app's existing 0.0005 display cutoff.
const MAX_SHRED_DEPTH = 10;

const FOCUS_DAMAGE_REDUCTION = 5;
const DEF_FLOOR = 5; // Knocked Down / Stationary / Paralysis all reduce a target's DEF to this base before other flat penalties.

// --- Persistent target debuff state -----------------------------------------------------

interface DebuffState {
  knockedDown: boolean;
  /** Explicitly inflicted Stationary. Ice Cage at 2+ stacks ALSO makes the target
   *  Stationary for to-hit purposes - see `isStationary` - but Shatter only cares
   *  about this flag plus that derived condition, never Ice Cage stacks directly. */
  stationary: boolean;
  iceCageStacks: number;
  shadowbind: boolean;
  blind: boolean;
  paralyzed: boolean;
  flare: boolean;
  weaken: boolean;
  /** Generic "-X ARM", cumulative across every instance that triggers. */
  armPenalty: number;
  /** Once true, every currently-Dispellable spell bonus/rule on the target is gone for the rest
   *  of the sequence - see `profileFor` and the `*PostDispel` fields on `SequenceTarget`. */
  dispelled: boolean;
  /** Once true, the target has neither Tough/Tough Steady nor Rapid Healing for the rest of the
   *  sequence, regardless of what `SequenceTarget` says - see `damageBranches`/`healBranches`. */
  grievouslyWounded: boolean;
}

const INITIAL_DEBUFFS: DebuffState = {
  knockedDown: false,
  stationary: false,
  iceCageStacks: 0,
  shadowbind: false,
  blind: false,
  paralyzed: false,
  flare: false,
  weaken: false,
  armPenalty: 0,
  dispelled: false,
  grievouslyWounded: false,
};

/** Ice Cage makes the target Stationary once it reaches 2 stacks, on top of an explicit Stationary effect. */
function isStationary(s: DebuffState): boolean {
  return s.stationary || s.iceCageStacks >= 2;
}

/** Knockdown and Stationary both auto-hit melee attacks and floor ranged/arcane DEF to 5 - see AttackType doc. */
function isKnockedDownOrStationary(s: DebuffState): boolean {
  return s.knockedDown || isStationary(s);
}

/** DEF used for this target's to-hit roll, given its current debuffs. */
function effectiveDef(baseDef: number, s: DebuffState): number {
  const floored = s.paralyzed || isKnockedDownOrStationary(s) ? DEF_FLOOR : baseDef;
  const flatPenalty = s.iceCageStacks * 2 + (s.shadowbind ? 3 : 0) + (s.blind ? 4 : 0) + (s.flare ? 2 : 0) + (s.weaken ? 2 : 0);
  return floored - flatPenalty;
}

function debuffKey(s: DebuffState): string {
  return `${s.knockedDown ? 1 : 0}${s.stationary ? 1 : 0}${s.iceCageStacks}${s.shadowbind ? 1 : 0}${s.blind ? 1 : 0}${s.paralyzed ? 1 : 0}${s.flare ? 1 : 0}${s.weaken ? 1 : 0}${s.dispelled ? 1 : 0}${s.grievouslyWounded ? 1 : 0}.${s.armPenalty}`;
}

function applyStatEffect(s: DebuffState, effect: StatEffect): DebuffState {
  switch (effect.type) {
    case 'knockdown':
      return s.knockedDown ? s : { ...s, knockedDown: true };
    case 'stationary':
      return s.stationary ? s : { ...s, stationary: true };
    case 'iceCage':
      return { ...s, iceCageStacks: s.iceCageStacks + 1 }; // the one effect that's explicitly cumulative
    case 'shadowbind':
      return s.shadowbind ? s : { ...s, shadowbind: true };
    case 'blind':
      return s.blind ? s : { ...s, blind: true };
    case 'paralysis':
      return s.paralyzed ? s : { ...s, paralyzed: true };
    case 'flare':
      return s.flare ? s : { ...s, flare: true };
    case 'weaken':
      return s.weaken ? s : { ...s, weaken: true };
    case 'armPenalty':
      return { ...s, armPenalty: s.armPenalty + (effect.amount ?? 0) };
    case 'dispel':
      return s.dispelled ? s : { ...s, dispelled: true };
    case 'grievousWounds':
      return s.grievouslyWounded ? s : { ...s, grievouslyWounded: true };
  }
}

/** Applies every statEffect that fires for this outcome ("hit" effects fire on any hit, including crits; "crit" effects only on crits). */
function applyStatEffectsForOutcome(s: DebuffState, statEffects: StatEffect[] | undefined, isCrit: boolean): DebuffState {
  if (!statEffects || statEffects.length === 0) return s;
  let next = s;
  for (const effect of statEffects) {
    const applies = effect.trigger === 'hit' || (effect.trigger === 'crit' && isCrit);
    if (applies) next = applyStatEffect(next, effect);
  }
  return next;
}

/** For a `rof`-equipped RANGED attack, the probability distribution over how many independent
 *  shots actually fire - decided ONCE, via a single die roll, before any of THIS attack's own
 *  dice are thrown (see the module doc comment's "Rate of Fire" section). Anything else
 *  (melee/arcane, or `rof` unset/'1') always fires exactly one shot. */
function rofOutcomes(atk: SequencedAttack): { count: number; probability: number }[] {
  if (atk.type !== 'ranged' || !atk.rof || atk.rof === '1') {
    return [{ count: 1, probability: 1 }];
  }
  if (atk.rof === 'd3') {
    return [1, 2, 3].map((count) => ({ count, probability: 1 / 3 }));
  }
  // '2d3': sum of two independent d3 rolls, faces 1-3 each equally likely.
  const dist = new Map<number, number>();
  for (let a = 1; a <= 3; a++) {
    for (let b = 1; b <= 3; b++) {
      dist.set(a + b, (dist.get(a + b) ?? 0) + 1 / 9);
    }
  }
  return [...dist.entries()].sort(([a], [b]) => a - b).map(([count, probability]) => ({ count, probability }));
}

// --- Resource (boxes / Focus / Fury) branching, independent of WHICH debuff state we're in ---

interface ResourceBranch {
  probability: number;
  boxes: number;
  debuffState: DebuffState;
  focusLeft: number;
  furyLeft: number;
  destroyed: boolean;
}

type ValueLookup = (boxes: number, debuffState: DebuffState, focusLeft: number, furyLeft: number) => number;

/** Like `ValueLookup`, but aware of every FIXED-rule/optimal-choice resource dimension that lives
 *  ABOVE `bestAction`'s own level (`attackChainValue`/`buildShotsValue`/the forward-pass
 *  equivalents) - Puppet Master's `pmMask`, Offensive Knowledge of the Damned's `kotdOffLeft`, and
 *  Defensive Knowledge of the Damned's `kotdDefLeft`. All three only ever change once, atomically,
 *  before a roll's outcome is even enumerated - see the module doc comment's Knowledge of the
 *  Damned section. */
type ExtendedValueLookup = (
  boxes: number,
  debuffState: DebuffState,
  focusLeft: number,
  furyLeft: number,
  pmMask: number,
  kotdOffLeft: number,
  kotdDefLeft: number
) => number;

/** One genuinely-occurring sub-population arising from Puppet Master's fixed rule at THIS roll -
 *  see `resolvePmSplit`. Unlike Focus/Fury's `bestAction`, this is never a competing CHOICE between
 *  alternatives: every population a call returns actually happens, in a different slice of the
 *  roll, each already scaled to its own share of the mass entering this roll. */
interface PmPopulation {
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
interface ToughRules {
  hasTough: boolean;
  hasToughSteady: boolean;
  hasToughPostDispel: boolean;
  hasToughSteadyPostDispel: boolean;
  failChance: number;
}

/** Rapid Healing is a target-level capability like Tough, rather than something Dispel can strip -
 *  Grievous Wounds is what turns it off instead (`DebuffState.grievouslyWounded`), so there's no
 *  pre/post-Dispel pair to bundle here the way `ToughRules` needs. */
interface HealingRules {
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
  healing: HealingRules
): ResourceBranch[] {
  if (!healing.hasRapidHealing || rawDamageDealt <= 0 || debuffState.grievouslyWounded) {
    return [{ probability: 1, boxes, debuffState, focusLeft, furyLeft, destroyed: false }];
  }
  return [1, 2, 3].map((healAmount) => ({
    probability: 1 / 3,
    boxes: Math.min(healing.initialBoxes, boxes + healAmount),
    debuffState,
    focusLeft,
    furyLeft,
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
  tough: ToughRules,
  healing: HealingRules
): ResourceBranch[] {
  const lethal = damageDealt >= boxes;
  if (!lethal) {
    return healBranches(boxes - damageDealt, rawDamageDealt, debuffState, focusLeft, furyLeft, healing);
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
    return [{ probability: 1, boxes: 0, debuffState, focusLeft, furyLeft, destroyed: true }];
  }
  // Tough simplification (see attack-model.ts): survives on 1 box and Knocked Down.
  const survivedState = debuffState.knockedDown ? debuffState : { ...debuffState, knockedDown: true };
  const survivedBranches = healBranches(1, rawDamageDealt, survivedState, focusLeft, furyLeft, healing).map((b) => ({
    ...b,
    probability: b.probability * (1 - tough.failChance),
  }));
  return [
    ...survivedBranches,
    { probability: tough.failChance, boxes: 0, debuffState, focusLeft, furyLeft, destroyed: true },
  ];
}

function branchesValue(branches: ResourceBranch[], valueAt: ValueLookup): number {
  return branches.reduce(
    (acc, b) => acc + b.probability * (b.destroyed ? 0 : valueAt(b.boxes, b.debuffState, b.focusLeft, b.furyLeft)),
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
function outcomeScore(branches: ResourceBranch[], valueAt: ValueLookup): [number, number, number] {
  let survivalValue = 0;
  let survivalProbability = 0;
  let expectedBoxes = 0;
  for (const b of branches) {
    if (b.destroyed) continue;
    survivalValue += b.probability * valueAt(b.boxes, b.debuffState, b.focusLeft, b.furyLeft);
    survivalProbability += b.probability;
    expectedBoxes += b.probability * b.boxes;
  }
  return [survivalValue, survivalProbability, expectedBoxes];
}

const SCORE_EPSILON = 1e-9;

/** True if `a` is strictly better than `b` under the lexicographic order described above. */
function isBetterScore(a: [number, number, number], b: [number, number, number]): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i] > b[i] + SCORE_EPSILON) return true;
    if (a[i] < b[i] - SCORE_EPSILON) return false;
  }
  return false;
}

/**
 * The target spends at most one resource point on this hit - none, a focus
 * point, or a fury point - whichever scores best (see `outcomeScore`).
 * `valueAt` (built by backward induction over the whole sequence) is what
 * lets this look ahead instead of just reacting to the current hit: e.g.
 * mitigating a big-but-survivable hit can be worth it purely to preserve
 * boxes against what's still coming.
 */
function bestAction(
  boxes: number,
  damageDealt: number,
  debuffState: DebuffState,
  focusLeft: number,
  furyLeft: number,
  tough: ToughRules,
  healing: HealingRules,
  valueAt: ValueLookup
): ResourceBranch[] {
  // `damageDealt` here is always the RAW damage (before this hit's own Focus/Fury choice, if any)
  // - it's passed through unchanged as `rawDamageDealt` to every candidate below, regardless of
  // how much of it that candidate's own mitigation actually blocks - see `damageBranches`.
  let bestBranches = damageBranches(boxes, damageDealt, damageDealt, debuffState, focusLeft, furyLeft, tough, healing);
  let bestScore = outcomeScore(bestBranches, valueAt);

  if (focusLeft > 0) {
    const branches = damageBranches(
      boxes,
      Math.max(0, damageDealt - FOCUS_DAMAGE_REDUCTION),
      damageDealt,
      debuffState,
      focusLeft - 1,
      furyLeft,
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
    const branches = damageBranches(boxes, 0, damageDealt, debuffState, focusLeft, furyLeft - 1, tough, healing);
    const score = outcomeScore(branches, valueAt);
    if (isBetterScore(score, bestScore)) {
      bestBranches = branches;
    }
  }

  return bestBranches;
}

// --- Per-(boxes, focus, fury) value table, one per reachable debuff state -------------------

/** [boxes][focusLeft][furyLeft] -> probability of surviving everything this table represents. */
type ValueTable = number[][][];

function buildValueTable(
  initialBoxes: number,
  maxFocus: number,
  maxFury: number,
  fill: (boxes: number, focusLeft: number, furyLeft: number) => number
): ValueTable {
  const table: ValueTable = [];
  for (let boxes = 0; boxes <= initialBoxes; boxes++) {
    const row: number[][] = [];
    for (let focus = 0; focus <= maxFocus; focus++) {
      row[focus] = [];
      for (let fury = 0; fury <= maxFury; fury++) {
        row[focus][fury] = fill(boxes, focus, fury);
      }
    }
    table[boxes] = row;
  }
  return table;
}

function readValueTable(table: ValueTable, boxes: number, focusLeft: number, furyLeft: number): number {
  return table[boxes][focusLeft][furyLeft];
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
  onProgress?: (fraction: number) => void
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

  /** Is `k` this attacker's own LAST attack in the sequence? Purely static (no debuff-state or
   *  randomness involved) - see the module doc comment's Puppet Master section. */
  function isLastAttackOfAttacker(k: number, atk: SequencedAttack): boolean {
    const list = pmAttackIndicesByAttacker.get(atk.attackerIndex ?? -1);
    return !!list && list[list.length - 1] === k;
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

  /** Is it ALREADY clear, given `debuffState` as of entering attack `k`, that every one of this
   *  attacker's own attacks from `k` onward (inclusive) is guaranteed to auto-hit? See the module
   *  doc comment's Knowledge of the Damned section. */
  function isAutoHitGuaranteedForRest(k: number, atk: SequencedAttack, debuffState: DebuffState): boolean {
    const list = pmAttackIndicesByAttacker.get(atk.attackerIndex ?? -1) ?? [];
    return list.filter((j) => j >= k).every((j) => rowIsAutoHitGuaranteed(attacks[j], debuffState));
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
  function remainingMissableRollCount(k: number, debuffState: DebuffState, shotsRemainingThisRow: number): number {
    const thisRow = rowIsAutoHitGuaranteed(attacks[k], debuffState) ? 0 : shotsRemainingThisRow;
    const laterRows = attacks.slice(k + 1).reduce((sum, row) => {
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
  function damageRerollEligibleForOffKotd(kotdOffLeft: number, k: number, debuffState: DebuffState, shotsRemainingThisRow: number): boolean {
    return kotdOffLeft > 0 && kotdOffLeft - 1 >= remainingMissableRollCount(k, debuffState, shotsRemainingThisRow);
  }

  // `pmMask`/`kotdOffLeft`/`kotdDefLeft` are all small, densely-enumerated resource dimensions
  // exactly like focus/fury, NOT a sparse reachability-pruned one like `DebuffState` - so they're
  // folded into the same composite Map key `DebuffState` already uses (one `ValueTable` per
  // reachable (debuffState, pmMask, kotdOffLeft, kotdDefLeft) tuple), rather than adding more array
  // axes to `ValueTable` itself.
  function tableKey(s: DebuffState, pmMask: number, kotdOffLeft: number, kotdDefLeft: number): string {
    return `${debuffKey(s)}|${pmMask}|${kotdOffLeft}|${kotdDefLeft}`;
  }

  // Attack profiles depend on the target's CURRENT debuffs (DEF/ARM/status), so they can't be
  // built once per attack like before a target could change mid-sequence - but the number of
  // distinct (autoHit, DEF, ARM, knockedDown, stationary) contexts actually encountered is
  // small, so caching per attack index keeps the expensive dice enumeration from ever repeating.
  const profileCache = new Map<string, AttackProfile>();

  /** The (usesAutoHit, def, arm) triple a given attack resolves against at this point in the
   *  sequence - shared by `profileFor` and `damageCheckPopulations` below (via `arm`), so Puppet
   *  Master's own damage-roll check resolves against the exact same target context `profileFor`
   *  already does. */
  function contextFor(atk: SequencedAttack, debuffState: DebuffState): { usesAutoHit: boolean; def: number; arm: number } {
    const immobilized = isKnockedDownOrStationary(debuffState);
    const usesAutoHit = !!atk.forceAutoHit || (atk.type === 'melee' && immobilized);
    // Blessed drops every Stat-type spell bonus (DEF and ARM); Dispel drops just the ones flagged
    // Dispellable. Both can apply at once (Blessed then just reads as 0 either way).
    const activeSpellDef = atk.blessed ? 0 : debuffState.dispelled ? defBonusPostDispel : defBonus;
    const activeSpellArm = atk.blessed ? 0 : debuffState.dispelled ? spellArmBonusPostDispel : spellArmBonus;
    // Chain Weapon drops Shield's ARM bonus specifically, regardless of Dispel (a spell-granted
    // Shield isn't reachable from the current UI, so Dispel never needs to touch this component).
    const activeShieldArm = atk.chainWeapon ? 0 : shieldArmBonus;
    const def = effectiveDef(baseDef, debuffState) + activeSpellDef;
    // Unyielding/Carapace only apply against their specific attack type, so - unlike Shield and
    // spell bonuses - they're resolved per attack here rather than folded into a flat bonus. Once
    // Dispel has fired, fall back to whichever half of each pair matches (see `SequenceTarget`).
    const activeUnyielding = debuffState.dispelled ? unyieldingPostDispel : unyielding;
    const activeCarapace = debuffState.dispelled ? carapacePostDispel : carapace;
    const conditionalArmBonus =
      (activeUnyielding && atk.type === 'melee' ? 2 : 0) + (activeCarapace && atk.type === 'ranged' ? 4 : 0);
    const arm = baseArm - debuffState.armPenalty + activeShieldArm + activeSpellArm + conditionalArmBonus;
    return { usesAutoHit, def, arm };
  }

  function profileFor(k: number, atk: SequencedAttack, debuffState: DebuffState): AttackProfile {
    const { usesAutoHit, def, arm } = contextFor(atk, debuffState);
    const cacheKey = `${k}|${usesAutoHit}|${def}|${arm}|${debuffState.knockedDown}|${isStationary(debuffState)}`;
    const cached = profileCache.get(cacheKey);
    if (cached) return cached;

    const profile = buildAttackProfile(
      { type: atk.type, stat: atk.stat, autoHit: usesAutoHit, modifiers: atk.modifiers },
      { pow: atk.pow, modifiers: atk.damageModifiers },
      { def, arm, baseArm, knockedDown: debuffState.knockedDown, stationary: isStationary(debuffState) },
      atk.effects,
      usesAutoHit
    );
    profileCache.set(cacheKey, profile);
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
    atk: SequencedAttack,
    debuffState: DebuffState,
    hitMassToCheck: Pick<AttackProfile, 'hitNonCritChance' | 'hitCritChance'>,
    trueOriginal: AttackProfile
  ): AverageRerollPopulation[] {
    const { arm } = contextFor(atk, debuffState);
    const target = { arm, baseArm, knockedDown: debuffState.knockedDown, stationary: isStationary(debuffState) };
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
  function resolvePmSplit(k: number, atk: SequencedAttack, debuffState: DebuffState, pmMask: number, trueOriginal: AttackProfile): PmPopulation[] {
    const pmBit = pmBitOf.get(atk.attackerIndex ?? -1);
    const pmAvailable = pmBit !== undefined && (pmMask & pmBit) === 0;
    if (!pmAvailable) return [{ profile: trueOriginal, resultingMask: pmMask }];

    const spentMask = pmMask | pmBit;
    const { usesAutoHit } = contextFor(atk, debuffState);
    const damageCheckEligible = isAutoHitGuaranteedForRest(k, atk, debuffState) || isLastAttackOfAttacker(k, atk);
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
        for (const p of damageRerollPopulations(atk, debuffState, trueOriginal, trueOriginal)) {
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
      for (const p of damageRerollPopulations(atk, debuffState, trueOriginal, trueOriginal)) {
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
    k: number,
    atk: SequencedAttack,
    debuffState: DebuffState,
    kotdOffLeft: number,
    shotsRemainingThisRow: number,
    inputProfile: AttackProfile,
    trueOriginal: AttackProfile
  ): KotdPopulation[] {
    if (kotdOffLeft === 0) return [{ profile: inputProfile, resultingLeft: 0 }];

    const { usesAutoHit } = contextFor(atk, debuffState);
    const damageEligible = damageRerollEligibleForOffKotd(kotdOffLeft, k, debuffState, shotsRemainingThisRow);
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
        for (const p of damageRerollPopulations(atk, debuffState, inputProfile, trueOriginal)) {
          populations.push({ profile: p.profile, resultingLeft: p.spent ? kotdOffLeft - 1 : kotdOffLeft });
        }
      } else if (inputProfile.hitNonCritChance + inputProfile.hitCritChance > 0) {
        populations.push({
          profile: { missChance: 0, hitNonCritChance: inputProfile.hitNonCritChance, hitCritChance: inputProfile.hitCritChance, nonCritDamage: inputProfile.nonCritDamage, critDamage: inputProfile.critDamage },
          resultingLeft: kotdOffLeft,
        });
      }
    } else if (damageEligible) {
      for (const p of damageRerollPopulations(atk, debuffState, inputProfile, trueOriginal)) {
        populations.push({ profile: p.profile, resultingLeft: p.spent ? kotdOffLeft - 1 : kotdOffLeft });
      }
    } else {
      populations.push({ profile: inputProfile, resultingLeft: kotdOffLeft });
    }

    return populations;
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

  /** Reroll the damage roll if it's currently above average - the mirror image of Puppet
   *  Master/Offensive Knowledge of the Damned's own below-average check, via
   *  `splitAttackDamageByAverage(..., 'rerollAboveAverage')`. Produces ONE merged profile (via
   *  `mergeWeighted`) rather than splitting into two disjoint populations, since Defensive Knowledge
   *  of the Damned picks a single whole-profile CANDIDATE to compare, not a mixture that always
   *  happens. `hitNonCritChance`/`hitCritChance` stay exactly `inputProfile`'s own - only the damage
   *  MAPS change, since the reroll-or-keep mixture is folded entirely into them (see `mergeWeighted`). */
  function rerollDamageIfAboveAverage(
    atk: SequencedAttack,
    debuffState: DebuffState,
    inputProfile: AttackProfile,
    trueOriginal: AttackProfile
  ): AttackProfile {
    const { arm } = contextFor(atk, debuffState);
    const target = { arm, baseArm, knockedDown: debuffState.knockedDown, stationary: isStationary(debuffState) };
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

  // Declared up here (rather than down by the forward simulation that mainly uses it) because
  // `resolveAttackChainForward` below needs the type for its `next` accumulator parameter.
  interface FwdState {
    boxes: number;
    debuffState: DebuffState;
    focusLeft: number;
    furyLeft: number;
    pmMask: number;
    kotdOffLeft: number;
    kotdDefLeft: number;
  }
  const fwdKey = (s: FwdState) =>
    `${s.boxes}|${debuffKey(s.debuffState)}|${s.focusLeft}|${s.furyLeft}|${s.pmMask}|${s.kotdOffLeft}|${s.kotdDefLeft}`;

  /** Resolves one already-realized `AppliedOutcome` of attack `k` into its `ResourceBranch[]` (via
   *  the existing `bestAction`/Focus-Fury choice, unaffected by anything above this level) plus the
   *  `ValueLookup` continuation that produced them - shared by `attackChainValue`'s own outer
   *  accumulation loop AND `profileScore` (Defensive Knowledge of the Damned's candidate scorer),
   *  so Critical Shred's recursive continuation logic is never duplicated (the single biggest
   *  correctness risk in this feature - see the module doc comment). */
  function resolveOneOutcome(
    outcome: AppliedOutcome,
    k: number,
    atk: SequencedAttack,
    debuffState: DebuffState,
    boxes: number,
    focusLeft: number,
    furyLeft: number,
    resultingMask: number,
    resultingOffKotdLeft: number,
    resultingDefKotdLeft: number,
    shotsRemainingThisRow: number,
    depthRemaining: number,
    outerValueAt: ExtendedValueLookup,
    cache: Map<string, number>
  ): { branches: ResourceBranch[]; continuationValueAt: ValueLookup } {
    const newDebuffState = applyStatEffectsForOutcome(debuffState, atk.statEffects, outcome.isCrit);
    const continuesChain = outcome.isCrit && !!atk.criticalShred && depthRemaining > 0;
    const continuationValueAt: ValueLookup = continuesChain
      ? (b, d, f, fu) =>
          attackChainValue(k, atk, d, b, f, fu, resultingMask, resultingOffKotdLeft, resultingDefKotdLeft, shotsRemainingThisRow, depthRemaining - 1, outerValueAt, cache)
      : (b, d, f, fu) => outerValueAt(b, d, f, fu, resultingMask, resultingOffKotdLeft, resultingDefKotdLeft);
    const branches = bestAction(boxes, outcome.damageDealt, newDebuffState, focusLeft, furyLeft, toughRules, healingRules, continuationValueAt);
    return { branches, continuationValueAt };
  }

  /** Aggregates `outcomeScore` (the SAME lexicographic survival-value/probability/expected-boxes
   *  triple `bestAction` already uses for Focus/Fury) across every outcome a WHOLE profile can
   *  produce, weighted by each outcome's own probability - the piece `bestAction` itself never
   *  needed, since it only ever scores a single already-realized outcome. Used ONLY to compare
   *  Defensive Knowledge of the Damned's candidate profiles against each other. */
  function profileScore(
    profile: AttackProfile,
    k: number,
    atk: SequencedAttack,
    debuffState: DebuffState,
    boxes: number,
    focusLeft: number,
    furyLeft: number,
    resultingMask: number,
    resultingOffKotdLeft: number,
    candidateDefKotdLeft: number,
    shotsRemainingThisRow: number,
    depthRemaining: number,
    outerValueAt: ExtendedValueLookup,
    cache: Map<string, number>
  ): [number, number, number] {
    let score: [number, number, number] = [0, 0, 0];
    for (const outcome of applyProfile(profile)) {
      const { branches, continuationValueAt } = resolveOneOutcome(
        outcome, k, atk, debuffState, boxes, focusLeft, furyLeft,
        resultingMask, resultingOffKotdLeft, candidateDefKotdLeft, shotsRemainingThisRow,
        depthRemaining, outerValueAt, cache
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
    k: number,
    atk: SequencedAttack,
    debuffState: DebuffState,
    kotdDefLeft: number,
    inputProfile: AttackProfile,
    trueOriginal: AttackProfile,
    boxes: number,
    focusLeft: number,
    furyLeft: number,
    resultingMask: number,
    resultingOffKotdLeft: number,
    shotsRemainingThisRow: number,
    depthRemaining: number,
    outerValueAt: ExtendedValueLookup,
    cache: Map<string, number>
  ): { profile: AttackProfile; resultingLeft: number } {
    if (kotdDefLeft === 0) return { profile: inputProfile, resultingLeft: 0 };

    const scoreOf = (profile: AttackProfile, candidateLeft: number) =>
      profileScore(profile, k, atk, debuffState, boxes, focusLeft, furyLeft, resultingMask, resultingOffKotdLeft, candidateLeft, shotsRemainingThisRow, depthRemaining, outerValueAt, cache);

    let best = { profile: inputProfile, resultingLeft: kotdDefLeft };
    let bestScore = scoreOf(inputProfile, kotdDefLeft);

    const { usesAutoHit } = contextFor(atk, debuffState);
    if (!usesAutoHit) {
      const candidate = rerollAttackRollIfHit(inputProfile, trueOriginal);
      const score = scoreOf(candidate, kotdDefLeft - 1);
      if (isBetterScore(score, bestScore)) {
        best = { profile: candidate, resultingLeft: kotdDefLeft - 1 };
        bestScore = score;
      }
    }

    const dmgCandidate = rerollDamageIfAboveAverage(atk, debuffState, inputProfile, trueOriginal);
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
  function attackChainValue(
    k: number,
    atk: SequencedAttack,
    debuffState: DebuffState,
    boxes: number,
    focusLeft: number,
    furyLeft: number,
    pmMask: number,
    kotdOffLeft: number,
    kotdDefLeft: number,
    shotsRemainingThisRow: number,
    depthRemaining: number,
    outerValueAt: ExtendedValueLookup,
    cache: Map<string, number>
  ): number {
    const key = `${depthRemaining}|${debuffKey(debuffState)}|${boxes}|${focusLeft}|${furyLeft}|${pmMask}|${kotdOffLeft}|${kotdDefLeft}`;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;

    const trueOriginal = profileFor(k, atk, debuffState);
    let total = 0;
    for (const { profile: pmProfile, resultingMask } of resolvePmSplit(k, atk, debuffState, pmMask, trueOriginal)) {
      for (const { profile: offProfile, resultingLeft: resultingOffKotdLeft } of resolveKotdOffSplit(
        k, atk, debuffState, kotdOffLeft, shotsRemainingThisRow, pmProfile, trueOriginal
      )) {
        const { profile: finalProfile, resultingLeft: resultingDefKotdLeft } = resolveKotdDefChoice(
          k, atk, debuffState, kotdDefLeft, offProfile, trueOriginal,
          boxes, focusLeft, furyLeft, resultingMask, resultingOffKotdLeft, shotsRemainingThisRow,
          depthRemaining, outerValueAt, cache
        );
        for (const outcome of applyProfile(finalProfile)) {
          const { branches, continuationValueAt } = resolveOneOutcome(
            outcome, k, atk, debuffState, boxes, focusLeft, furyLeft,
            resultingMask, resultingOffKotdLeft, resultingDefKotdLeft, shotsRemainingThisRow,
            depthRemaining, outerValueAt, cache
          );
          total += outcome.probability * branchesValue(branches, continuationValueAt);
        }
      }
    }

    cache.set(key, total);
    return total;
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
   * this isn't written that way. `stats.hitMass`/`critMass` only accumulate for the FIRST
   * instance (depth === `MAX_SHRED_DEPTH`) AND only when `trackHitCrit` is true - "Hit"/"Crit"
   * chance are the ORIGINAL roll's own (a single well-defined probability), unlike "Avg damage"
   * which stays meaningful summed across however many instances actually fired (see the module
   * doc comment). `trackHitCrit` lets `resolveRofAttackForward` (see the module doc comment's
   * "Rate of Fire" section) call this once per shot in a volley while still only counting the
   * volley's OWN first shot toward hitMass/critMass, not every shot in it.
   */
  function resolveAttackChainForward(
    k: number,
    atk: SequencedAttack,
    debuffState: DebuffState,
    boxes: number,
    focusLeft: number,
    furyLeft: number,
    pmMask: number,
    kotdOffLeft: number,
    kotdDefLeft: number,
    shotsRemainingThisRow: number,
    probability: number,
    outerValueAt: ExtendedValueLookup,
    shredCache: Map<string, number>,
    stats: { hitMass: number; critMass: number; damageMass: number },
    next: Map<string, { state: FwdState; probability: number }>,
    destroyed: { mass: number },
    trackHitCrit: boolean
  ): void {
    const initialState: FwdState = { boxes, debuffState, focusLeft, furyLeft, pmMask, kotdOffLeft, kotdDefLeft };
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
        // of their populations; Defensive Knowledge of the Damned's choice is recomputed fresh
        // (pure function of reproducible inputs, exactly like `bestAction` already is in both
        // passes today).
        const trueOriginal = profileFor(k, atk, state.debuffState);
        for (const { profile: pmProfile, resultingMask } of resolvePmSplit(k, atk, state.debuffState, state.pmMask, trueOriginal)) {
          for (const { profile: offProfile, resultingLeft: resultingOffKotdLeft } of resolveKotdOffSplit(
            k, atk, state.debuffState, state.kotdOffLeft, shotsRemainingThisRow, pmProfile, trueOriginal
          )) {
            const { profile: finalProfile, resultingLeft: resultingDefKotdLeft } = resolveKotdDefChoice(
              k, atk, state.debuffState, state.kotdDefLeft, offProfile, trueOriginal,
              state.boxes, state.focusLeft, state.furyLeft, resultingMask, resultingOffKotdLeft, shotsRemainingThisRow,
              depthRemaining, outerValueAt, shredCache
            );
            for (const outcome of applyProfile(finalProfile)) {
              const p = p0 * outcome.probability;
              if (p <= 0) continue;
              if (topLevel && trackHitCrit) {
                if (outcome.isHit) stats.hitMass += p;
                if (outcome.isCrit) stats.critMass += p;
              }
              stats.damageMass += p * outcome.damageDealt;

              const continuesChain = outcome.isCrit && !!atk.criticalShred && depthRemaining > 0;
              const { branches } = resolveOneOutcome(
                outcome, k, atk, state.debuffState, state.boxes, state.focusLeft, state.furyLeft,
                resultingMask, resultingOffKotdLeft, resultingDefKotdLeft, shotsRemainingThisRow,
                depthRemaining, outerValueAt, shredCache
              );

              for (const b of branches) {
                const pp = p * b.probability;
                if (pp <= 0) continue;
                if (b.destroyed) {
                  destroyed.mass += pp;
                  continue;
                }
                const fwd: FwdState = {
                  boxes: b.boxes, debuffState: b.debuffState, focusLeft: b.focusLeft, furyLeft: b.furyLeft,
                  pmMask: resultingMask, kotdOffLeft: resultingOffKotdLeft, kotdDefLeft: resultingDefKotdLeft,
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

      current = continuing;
      depthRemaining--;
    }
  }

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
    getNextTable: (debuffState: DebuffState, pmMask: number, kotdOffLeft: number, kotdDefLeft: number) => ValueTable
  ): (shotsRemaining: number, debuffState: DebuffState, boxes: number, focusLeft: number, furyLeft: number, pmMask: number, kotdOffLeft: number, kotdDefLeft: number) => number {
    const maxShots = Math.max(...rofOutcomes(atk).map((o) => o.count));
    const cachesByShotsRemaining: Map<string, number>[] = Array.from({ length: maxShots + 1 }, () => new Map());

    function shotsValue(
      shotsRemaining: number,
      debuffState: DebuffState,
      boxes: number,
      focusLeft: number,
      furyLeft: number,
      pmMask: number,
      kotdOffLeft: number,
      kotdDefLeft: number
    ): number {
      if (shotsRemaining === 0) {
        const table = getNextTable(debuffState, pmMask, kotdOffLeft, kotdDefLeft);
        return readValueTable(table, boxes, focusLeft, furyLeft);
      }
      return attackChainValue(
        k,
        atk,
        debuffState,
        boxes,
        focusLeft,
        furyLeft,
        pmMask,
        kotdOffLeft,
        kotdDefLeft,
        shotsRemaining - 1,
        MAX_SHRED_DEPTH,
        (b, d, f, fu, m, o, dk) => shotsValue(shotsRemaining - 1, d, b, f, fu, m, o, dk),
        cachesByShotsRemaining[shotsRemaining]
      );
    }

    return shotsValue;
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
  const baseValueTable = buildValueTable(initialBoxes, maxFocus, maxFury, () => 1);
  const getValueTableAt: ((debuffState: DebuffState, pmMask: number, kotdOffLeft: number, kotdDefLeft: number) => ValueTable)[] = new Array(n + 1);
  getValueTableAt[n] = () => baseValueTable;

  // Built once per attack as the backward pass reaches it, then reused by the forward pass below.
  const shotsValueByAttack: ((shotsRemaining: number, debuffState: DebuffState, boxes: number, focusLeft: number, furyLeft: number, pmMask: number, kotdOffLeft: number, kotdDefLeft: number) => number)[] =
    new Array(n);

  for (let k = n - 1; k >= 0; k--) {
    const atk = attacks[k];
    const shotsValue = buildShotsValue(k, atk, getValueTableAt[k + 1]);
    shotsValueByAttack[k] = shotsValue;
    const rofDist = rofOutcomes(atk);
    const cache = new Map<string, ValueTable>();

    getValueTableAt[k] = (debuffState, mask, off, def) => {
      const key = tableKey(debuffState, mask, off, def);
      const cached = cache.get(key);
      if (cached) return cached;
      const table = buildValueTable(initialBoxes, maxFocus, maxFury, (boxes, focus, fury) =>
        rofDist.reduce((sum, { count, probability }) => sum + probability * shotsValue(count, debuffState, boxes, focus, fury, mask, off, def), 0)
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
   * K actually leaves remaining", not a blended average). `stats.hitMass`/`critMass` only
   * accumulate on each branch's own first shot (`trackHitCrit`) - since shot 1 always fires (every
   * `rofDist` count is >= 1) and its outcome distribution is identical regardless of which K a
   * given branch drew, summing it once per branch, weighted by that branch's own probability
   * share, reconstructs the correct total automatically (the branch probabilities already sum
   * back to the original incoming mass).
   */
  function resolveRofAttackForward(
    k: number,
    atk: SequencedAttack,
    initialDist: Map<string, { state: FwdState; probability: number }>,
    shotsValue: (shotsRemaining: number, debuffState: DebuffState, boxes: number, focusLeft: number, furyLeft: number, pmMask: number, kotdOffLeft: number, kotdDefLeft: number) => number,
    stats: { hitMass: number; critMass: number; damageMass: number },
    next: Map<string, { state: FwdState; probability: number }>,
    destroyed: { mass: number }
  ): void {
    for (const { count, probability: rofP } of rofOutcomes(atk)) {
      let current = new Map<string, { state: FwdState; probability: number }>();
      for (const { state, probability } of initialDist.values()) {
        const p = probability * rofP;
        if (p <= 0) continue;
        const key = fwdKey(state);
        const existing = current.get(key);
        if (existing) existing.probability += p;
        else current.set(key, { state, probability: p });
      }

      for (let shotIndex = 1; shotIndex <= count; shotIndex++) {
        const shotsRemainingAfter = count - shotIndex;
        const isLastShot = shotIndex === count;
        const shredCache = new Map<string, number>();
        const survivors = new Map<string, { state: FwdState; probability: number }>();
        const valueAt: ExtendedValueLookup = (b, d, f, fu, m, o, dk) => shotsValue(shotsRemainingAfter, d, b, f, fu, m, o, dk);

        for (const { state, probability } of current.values()) {
          resolveAttackChainForward(
            k,
            atk,
            state.debuffState,
            state.boxes,
            state.focusLeft,
            state.furyLeft,
            state.pmMask,
            state.kotdOffLeft,
            state.kotdDefLeft,
            shotsRemainingAfter,
            probability,
            valueAt,
            shredCache,
            stats,
            isLastShot ? next : survivors,
            destroyed,
            shotIndex === 1
          );
        }

        current = survivors;
      }
    }
  }

  // --- Forward simulation, replaying the policy above to get step-by-step stats ---
  let dist = new Map<string, { state: FwdState; probability: number }>();
  const initialDebuffs = startsKnockedDown ? { ...INITIAL_DEBUFFS, knockedDown: true } : INITIAL_DEBUFFS;
  const initialState: FwdState = {
    boxes: initialBoxes,
    debuffState: initialDebuffs,
    focusLeft: maxFocus,
    furyLeft: maxFury,
    pmMask: 0,
    kotdOffLeft: maxKotdOff,
    kotdDefLeft: maxKotdDef,
  };
  dist.set(fwdKey(initialState), { state: initialState, probability: 1 });

  const steps: SequenceStepResult[] = [];
  let cumulativeDestroy = 0;

  for (let k = 0; k < n; k++) {
    const atk = attacks[k];
    const shotsValue = shotsValueByAttack[k];

    const next = new Map<string, { state: FwdState; probability: number }>();
    const stats = { hitMass: 0, critMass: 0, damageMass: 0 };
    const destroyed = { mass: 0 };
    let aliveMass = 0;
    for (const { probability } of dist.values()) aliveMass += probability;

    resolveRofAttackForward(k, atk, dist, shotsValue, stats, next, destroyed);

    cumulativeDestroy += destroyed.mass;
    dist = next;

    const expectedBoxesRemaining = [...dist.values()].reduce(
      (acc, { state, probability }) => acc + state.boxes * probability,
      0
    );

    steps.push({
      attack: atk,
      hitChance: aliveMass > 0 ? stats.hitMass / aliveMass : 0,
      critChance: aliveMass > 0 ? stats.critMass / aliveMass : 0,
      averageDamage: aliveMass > 0 ? stats.damageMass / aliveMass : 0,
      destroyChanceAtThisStep: destroyed.mass,
      cumulativeDestroyChance: cumulativeDestroy,
      expectedBoxesRemaining,
    });

    onProgress?.((k + 1) / n);
  }

  const survivalByBoxes = new Map<number, number>();
  for (const { state, probability } of dist.values()) {
    survivalByBoxes.set(state.boxes, (survivalByBoxes.get(state.boxes) ?? 0) + probability);
  }
  const survivalDistribution = [...survivalByBoxes.entries()]
    .map(([boxes, probability]) => ({ boxes, probability }))
    .sort((a, b) => a.boxes - b.boxes);

  return { steps, finalDestroyChance: cumulativeDestroy, survivalDistribution };
}
