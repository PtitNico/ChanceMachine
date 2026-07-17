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
 * "no once-per-turn limit". `computeReachableDebuffStates` widens its over-approximation to match:
 * a Shred chain can trigger the SAME crit-only persistent effect (Ice Cage, "-X ARM") repeatedly,
 * once per instance in the chain, so it explores up to `MAX_SHRED_DEPTH + 1` repeated crit
 * applications for a shredding attack instead of just one. In the step-by-step breakdown, "Avg
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
 * Performance note: we do NOT branch into one probability tree per attack
 * (that would blow up combinatorially). Instead we track a small probability
 * distribution over the target's *state* (boxes remaining, debuffs, focus/fury
 * remaining) and fold each attack into it in turn. Each attack's dice-pool
 * enumeration (the expensive part) is cached per attack and per distinct
 * (DEF, ARM, status) context it's actually resolved against - contexts are
 * few in practice (bounded by how many debuff-inflicting effects are
 * actually configured across the sequence), so this stays effectively
 * instant even for ~10 attacks.
 */

import {
  AttackEffects,
  AttackProfile,
  AttackType,
  EffectTrigger,
  RollModifiers,
  applyProfile,
  buildAttackProfile,
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
  /** Expected RAW damage dealt over the whole sequence - the sum of every step's own raw,
   *  uncapped damage (see `SequenceStepResult.averageDamage`), each weighted by the probability
   *  the target was still alive when that step fired. Unlike `boxesInitial - steps.at(-1)
   *  .expectedBoxesRemaining` (which caps at the target's box count, since a destroyed target
   *  can't lose more boxes than it had), this counts "wasted" overkill damage too - dice that
   *  landed but didn't matter because the target was already destroyed by that same hit. */
  totalRawDamage: number;
}

const MAX_RESOURCE_POINTS = 10; // far beyond any Warmachine/Hordes caster's focus/fury stat; guards the value-table size.

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

/** Every DebuffState reachable from ONE resolution of `atk`, starting from `state` - miss/no
 *  trigger, a "hit" trigger, or (if Critical Shred is active) up to MAX_SHRED_DEPTH+1 repeated
 *  "crit" triggers from the chain's own successive instances. */
function attackTransitionCandidates(state: DebuffState, atk: SequencedAttack): DebuffState[] {
  const candidates = [
    state, // miss, or a hit/crit that triggers nothing
    applyStatEffectsForOutcome(state, atk.statEffects, false),
  ];
  // A Critical Shred attack can trigger its own crit-only statEffects repeatedly - a stacking
  // effect (Ice Cage, "-X ARM") can end up applied once per instance in the chain, not just
  // once. Over-approximate by exploring every "N repeated crits" state up to the same depth
  // cap the actual chain resolution uses (see `attackChainValue`), so every state the real
  // resolution can reach always has a value table built for it in the next step.
  let critState = state;
  const maxCrits = atk.criticalShred ? MAX_SHRED_DEPTH + 1 : 1;
  for (let i = 0; i < maxCrits; i++) {
    critState = applyStatEffectsForOutcome(critState, atk.statEffects, true);
    candidates.push(critState);
  }
  return candidates;
}

/**
 * The set of debuff states reachable just BEFORE each attack resolves (index 0 = before the
 * first attack, ... index n = after the last). Debuff transitions don't depend on boxes or
 * Focus/Fury at all, so this can be precomputed as its own small pass - it's what lets the
 * main computation below avoid a dense table over every debuff dimension: only debuff states
 * that can actually occur for THIS sequence ever get a value-table built for them.
 *
 * Deliberately over-approximates rather than tracking exact probabilities: it doesn't matter
 * if a listed state turns out to carry zero probability once autoHit/thresholds are taken into
 * account, only that every state that COULD carry nonzero probability is included.
 */
function computeReachableDebuffStates(
  attacks: SequencedAttack[],
  startsKnockedDown: boolean,
  hasAnyTough: boolean
): DebuffState[][] {
  const perStep: DebuffState[][] = [];
  const initial = startsKnockedDown ? { ...INITIAL_DEBUFFS, knockedDown: true } : INITIAL_DEBUFFS;
  let current = new Map<string, DebuffState>([[debuffKey(initial), initial]]);
  perStep.push([...current.values()]);

  for (const atk of attacks) {
    // A Rate of Fire attack fires up to `maxShots` independent shots against this same target
    // before the NEXT row resolves - each shot can independently trigger the attack's own
    // statEffects (and, if Critical Shred is also active, its own chain of those - see
    // attackTransitionCandidates), so the reachable-state exploration below runs once per
    // possible shot rather than once total.
    const maxShots = Math.max(...rofOutcomes(atk).map((o) => o.count));
    for (let shot = 0; shot < maxShots; shot++) {
      const next = new Map<string, DebuffState>();
      const add = (s: DebuffState) => {
        const k = debuffKey(s);
        if (!next.has(k)) next.set(k, s);
      };
      for (const state of current.values()) {
        for (const candidate of attackTransitionCandidates(state, atk)) {
          add(candidate);
          // Surviving a Tough or Tough Steady roll always also knocks the target down (see
          // damageBranches), regardless of which of the candidates above it happens on top of.
          if (hasAnyTough && !candidate.knockedDown) {
            add({ ...candidate, knockedDown: true });
          }
        }
      }
      current = next;
    }
    perStep.push([...current.values()]);
  }
  return perStep;
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

export function computeSequenceOdds(attacks: SequencedAttack[], target: SequenceTarget): SequenceResult {
  const initialBoxes = target.boxes;
  const maxFocus = Math.floor(target.focusPoints ?? 0);
  const maxFury = Math.floor(target.furyPoints ?? 0);
  if (maxFocus < 0 || maxFury < 0) {
    throw new Error('focusPoints and furyPoints must not be negative');
  }
  if (maxFocus > MAX_RESOURCE_POINTS || maxFury > MAX_RESOURCE_POINTS) {
    throw new Error(`focusPoints/furyPoints=${maxFocus}/${maxFury} is unrealistically large (cap: ${MAX_RESOURCE_POINTS})`);
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

  const debuffStatesPerStep = computeReachableDebuffStates(attacks, startsKnockedDown, hasAnyTough);

  // Attack profiles depend on the target's CURRENT debuffs (DEF/ARM/status), so they can't be
  // built once per attack like before a target could change mid-sequence - but the number of
  // distinct (autoHit, DEF, ARM, knockedDown, stationary) contexts actually encountered is
  // small, so caching per attack index keeps the expensive dice enumeration from ever repeating.
  const profileCache = new Map<string, AttackProfile>();
  function profileFor(k: number, atk: SequencedAttack, debuffState: DebuffState): AttackProfile {
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

  // Declared up here (rather than down by the forward simulation that mainly uses it) because
  // `resolveAttackChainForward` below needs the type for its `next` accumulator parameter.
  interface FwdState {
    boxes: number;
    debuffState: DebuffState;
    focusLeft: number;
    furyLeft: number;
  }
  const fwdKey = (s: FwdState) => `${s.boxes}|${debuffKey(s.debuffState)}|${s.focusLeft}|${s.furyLeft}`;

  /**
   * Resolves one instance of attack `k` starting from the given state, and - if that instance
   * crits and `atk.criticalShred` is set - recurses into ANOTHER instance of itself instead of
   * falling through to `outerValueAt` (which represents "attacks k+1 onward"), up to
   * `MAX_SHRED_DEPTH` deep. Attacks without Critical Shred take the `outerValueAt` branch on
   * every outcome, so this degenerates to exactly the pre-Shred single-instance computation - it
   * replaces the plain `bestAction`+`branchesValue` call at every use site, shred or not.
   * Memoized per (depthRemaining, debuffState, boxes, focus, fury): the same state is frequently
   * reachable via multiple different paths through both the recursion and the surrounding
   * (boxes x focus x fury) grid this is called from.
   */
  function attackChainValue(
    k: number,
    atk: SequencedAttack,
    debuffState: DebuffState,
    boxes: number,
    focusLeft: number,
    furyLeft: number,
    depthRemaining: number,
    outerValueAt: ValueLookup,
    cache: Map<string, number>
  ): number {
    const key = `${depthRemaining}|${debuffKey(debuffState)}|${boxes}|${focusLeft}|${furyLeft}`;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;

    const profile = profileFor(k, atk, debuffState);
    let total = 0;
    for (const outcome of applyProfile(profile)) {
      const newDebuffState = applyStatEffectsForOutcome(debuffState, atk.statEffects, outcome.isCrit);
      const continuesChain = outcome.isCrit && !!atk.criticalShred && depthRemaining > 0;
      const continuationValueAt: ValueLookup = continuesChain
        ? (b, d, f, fu) => attackChainValue(k, atk, d, b, f, fu, depthRemaining - 1, outerValueAt, cache)
        : outerValueAt;
      const branches = bestAction(boxes, outcome.damageDealt, newDebuffState, focusLeft, furyLeft, toughRules, healingRules, continuationValueAt);
      total += outcome.probability * branchesValue(branches, continuationValueAt);
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
    probability: number,
    outerValueAt: ValueLookup,
    shredCache: Map<string, number>,
    stats: { hitMass: number; critMass: number; damageMass: number },
    next: Map<string, { state: FwdState; probability: number }>,
    destroyed: { mass: number },
    trackHitCrit: boolean
  ): void {
    const initialState: FwdState = { boxes, debuffState, focusLeft, furyLeft };
    let current = new Map<string, { state: FwdState; probability: number }>([
      [fwdKey(initialState), { state: initialState, probability }],
    ]);
    let depthRemaining = MAX_SHRED_DEPTH;

    while (current.size > 0) {
      const topLevel = depthRemaining === MAX_SHRED_DEPTH;
      const continuing = new Map<string, { state: FwdState; probability: number }>();

      for (const { state, probability: p0 } of current.values()) {
        if (p0 <= 0) continue;
        const profile = profileFor(k, atk, state.debuffState);
        for (const outcome of applyProfile(profile)) {
          const p = p0 * outcome.probability;
          if (p <= 0) continue;
          if (topLevel && trackHitCrit) {
            if (outcome.isHit) stats.hitMass += p;
            if (outcome.isCrit) stats.critMass += p;
          }
          stats.damageMass += p * outcome.damageDealt;

          const newDebuffState = applyStatEffectsForOutcome(state.debuffState, atk.statEffects, outcome.isCrit);
          const continuesChain = outcome.isCrit && !!atk.criticalShred && depthRemaining > 0;
          const continuationValueAt: ValueLookup = continuesChain
            ? (b, d, f, fu) => attackChainValue(k, atk, d, b, f, fu, depthRemaining - 1, outerValueAt, shredCache)
            : outerValueAt;
          const branches = bestAction(
            state.boxes,
            outcome.damageDealt,
            newDebuffState,
            state.focusLeft,
            state.furyLeft,
            toughRules,
            healingRules,
            continuationValueAt
          );

          for (const b of branches) {
            const pp = p * b.probability;
            if (pp <= 0) continue;
            if (b.destroyed) {
              destroyed.mass += pp;
              continue;
            }
            const fwd: FwdState = { boxes: b.boxes, debuffState: b.debuffState, focusLeft: b.focusLeft, furyLeft: b.furyLeft };
            const key = fwdKey(fwd);
            const target = continuesChain ? continuing : next;
            const existing = target.get(key);
            if (existing) existing.probability += pp;
            else target.set(key, { state: fwd, probability: pp });
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
   * "attacks k+1 onward" (`nextTables`); `shotsValue(s, ...)` for s > 0 is "resolve one more shot
   * of this attack (`attackChainValue`, which already handles that one shot's own Critical Shred
   * chain if any), then `shotsValue(s-1, ...)` afterward". A single cache PER LEVEL s (not one per
   * grid point) is safe and sufficient, exactly like the plain per-attack `shredCache` used to be:
   * `shotsValue(s-1, ...)` is a pure function of (boxes, debuffState, focus, fury) alone, identical
   * no matter which debuffState/grid-point this level was entered from. Returned rather than
   * inlined so the forward pass below can reuse the exact same functions (and their caches) as its
   * own per-shot lookahead, keeping the replayed Focus/Fury policy consistent with what the
   * backward pass actually optimized for.
   */
  function buildShotsValue(
    k: number,
    atk: SequencedAttack,
    nextTables: Map<string, ValueTable>
  ): (shotsRemaining: number, debuffState: DebuffState, boxes: number, focusLeft: number, furyLeft: number) => number {
    const maxShots = Math.max(...rofOutcomes(atk).map((o) => o.count));
    const cachesByShotsRemaining: Map<string, number>[] = Array.from({ length: maxShots + 1 }, () => new Map());

    function shotsValue(shotsRemaining: number, debuffState: DebuffState, boxes: number, focusLeft: number, furyLeft: number): number {
      if (shotsRemaining === 0) {
        const table = nextTables.get(debuffKey(debuffState));
        // Should always be present - computeReachableDebuffStates over-approximates, never under.
        return table ? readValueTable(table, boxes, focusLeft, furyLeft) : 0;
      }
      return attackChainValue(
        k,
        atk,
        debuffState,
        boxes,
        focusLeft,
        furyLeft,
        MAX_SHRED_DEPTH,
        (b, d, f, fu) => shotsValue(shotsRemaining - 1, d, b, f, fu),
        cachesByShotsRemaining[shotsRemaining]
      );
    }

    return shotsValue;
  }

  // --- Backward induction ---
  // valueTables[k] = one (boxes x focus x fury) table PER reachable debuff state, giving
  // P(survive attacks[k..n-1] onward | state), playing the optimal Focus/Fury policy.
  // valueTables[n] is the base case: no attacks left, so any alive state has already survived.
  const valueTables: Map<string, ValueTable>[] = new Array(n + 1);
  valueTables[n] = new Map();
  for (const debuffState of debuffStatesPerStep[n]) {
    valueTables[n].set(debuffKey(debuffState), buildValueTable(initialBoxes, maxFocus, maxFury, () => 1));
  }

  // Built once per attack as the backward pass reaches it, then reused by the forward pass below.
  const shotsValueByAttack: ((shotsRemaining: number, debuffState: DebuffState, boxes: number, focusLeft: number, furyLeft: number) => number)[] =
    new Array(n);

  for (let k = n - 1; k >= 0; k--) {
    const atk = attacks[k];
    const nextTables = valueTables[k + 1];
    valueTables[k] = new Map();
    const shotsValue = buildShotsValue(k, atk, nextTables);
    shotsValueByAttack[k] = shotsValue;
    const rofDist = rofOutcomes(atk);

    for (const debuffState of debuffStatesPerStep[k]) {
      const table = buildValueTable(initialBoxes, maxFocus, maxFury, (boxes, focus, fury) =>
        rofDist.reduce((sum, { count, probability }) => sum + probability * shotsValue(count, debuffState, boxes, focus, fury), 0)
      );

      valueTables[k].set(debuffKey(debuffState), table);
    }
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
    shotsValue: (shotsRemaining: number, debuffState: DebuffState, boxes: number, focusLeft: number, furyLeft: number) => number,
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
        const valueAt: ValueLookup = (b, d, f, fu) => shotsValue(shotsRemainingAfter, d, b, f, fu);

        for (const { state, probability } of current.values()) {
          resolveAttackChainForward(
            k,
            atk,
            state.debuffState,
            state.boxes,
            state.focusLeft,
            state.furyLeft,
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
  };
  dist.set(fwdKey(initialState), { state: initialState, probability: 1 });

  const steps: SequenceStepResult[] = [];
  let cumulativeDestroy = 0;
  let totalRawDamage = 0;

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
    // `stats.damageMass` is already probability-weighted (unconditional), so summing it directly
    // across steps - rather than re-weighting each step's own `averageDamage` by its aliveMass -
    // gives the whole sequence's expected raw damage, uncapped by the target's box count.
    totalRawDamage += stats.damageMass;
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
  }

  const survivalByBoxes = new Map<number, number>();
  for (const { state, probability } of dist.values()) {
    survivalByBoxes.set(state.boxes, (survivalByBoxes.get(state.boxes) ?? 0) + probability);
  }
  const survivalDistribution = [...survivalByBoxes.entries()]
    .map(([boxes, probability]) => ({ boxes, probability }))
    .sort((a, b) => a.boxes - b.boxes);

  return { steps, finalDestroyChance: cumulativeDestroy, survivalDistribution, totalRawDamage };
}
