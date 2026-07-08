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
 *  each in `docs/`. 'dispel' is the odd one out - it doesn't debuff DEF/ARM directly, it strips
 *  every currently-dispellable spell bonus/rule off the target (see `profileFor`) - but it's
 *  modeled the same way (a `DebuffState` flag that, once set, persists for the rest of the
 *  sequence) since it's exactly as "sticky" as the others. */
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
  | 'dispel';

export interface StatEffect {
  type: StatEffectType;
  trigger: EffectTrigger;
  /** Only meaningful for 'armPenalty' (generic "-X ARM"): how much ARM to remove. */
  amount?: number;
}

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
  return `${s.knockedDown ? 1 : 0}${s.stationary ? 1 : 0}${s.iceCageStacks}${s.shadowbind ? 1 : 0}${s.blind ? 1 : 0}${s.paralyzed ? 1 : 0}${s.flare ? 1 : 0}${s.weaken ? 1 : 0}${s.dispelled ? 1 : 0}.${s.armPenalty}`;
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
    const next = new Map<string, DebuffState>();
    const add = (s: DebuffState) => {
      const k = debuffKey(s);
      if (!next.has(k)) next.set(k, s);
    };
    for (const state of current.values()) {
      const candidates = [
        state, // miss, or a hit/crit that triggers nothing
        applyStatEffectsForOutcome(state, atk.statEffects, false),
        applyStatEffectsForOutcome(state, atk.statEffects, true),
      ];
      for (const candidate of candidates) {
        add(candidate);
        // Surviving a Tough or Tough Steady roll always also knocks the target down (see
        // damageBranches), regardless of which of the candidates above it happens on top of.
        if (hasAnyTough && !candidate.knockedDown) {
          add({ ...candidate, knockedDown: true });
        }
      }
    }
    current = next;
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

/** Applies a (possibly already-mitigated) damage value against the target's boxes, bifurcating on a Tough roll if lethal. */
function damageBranches(
  boxes: number,
  damageDealt: number,
  debuffState: DebuffState,
  focusLeft: number,
  furyLeft: number,
  tough: ToughRules
): ResourceBranch[] {
  const lethal = damageDealt >= boxes;
  if (!lethal) {
    return [{ probability: 1, boxes: boxes - damageDealt, debuffState, focusLeft, furyLeft, destroyed: false }];
  }
  // Once Dispel has fired, a spell-granted Tough/Tough Steady is gone - fall back to whichever
  // half of the pair matches the target's current (innate-only, once dispelled) toughness.
  const hasTough = debuffState.dispelled ? tough.hasToughPostDispel : tough.hasTough;
  const hasToughSteady = debuffState.dispelled ? tough.hasToughSteadyPostDispel : tough.hasToughSteady;
  // Plain Tough can't be attempted while Knocked Down/Stationary (the real tabletop rule); Tough
  // Steady is immune to that negation - that's the entire difference between the two abilities.
  const toughApplies = hasToughSteady || (hasTough && !isKnockedDownOrStationary(debuffState));
  if (!toughApplies) {
    return [{ probability: 1, boxes: 0, debuffState, focusLeft, furyLeft, destroyed: true }];
  }
  // Tough simplification (see attack-model.ts): survives on 1 box and Knocked Down.
  const survivedState = debuffState.knockedDown ? debuffState : { ...debuffState, knockedDown: true };
  return [
    { probability: 1 - tough.failChance, boxes: 1, debuffState: survivedState, focusLeft, furyLeft, destroyed: false },
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
  valueAt: ValueLookup
): ResourceBranch[] {
  let bestBranches = damageBranches(boxes, damageDealt, debuffState, focusLeft, furyLeft, tough);
  let bestScore = outcomeScore(bestBranches, valueAt);

  if (focusLeft > 0) {
    const branches = damageBranches(
      boxes,
      Math.max(0, damageDealt - FOCUS_DAMAGE_REDUCTION),
      debuffState,
      focusLeft - 1,
      furyLeft,
      tough
    );
    const score = outcomeScore(branches, valueAt);
    if (isBetterScore(score, bestScore)) {
      bestBranches = branches;
      bestScore = score;
    }
  }

  if (furyLeft > 0) {
    const branches = damageBranches(boxes, 0, debuffState, focusLeft, furyLeft - 1, tough);
    const score = outcomeScore(branches, valueAt);
    if (isBetterScore(score, bestScore)) {
      bestBranches = branches;
      bestScore = score;
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

  // --- Backward induction ---
  // valueTables[k] = one (boxes x focus x fury) table PER reachable debuff state, giving
  // P(survive attacks[k..n-1] onward | state), playing the optimal Focus/Fury policy.
  // valueTables[n] is the base case: no attacks left, so any alive state has already survived.
  const valueTables: Map<string, ValueTable>[] = new Array(n + 1);
  valueTables[n] = new Map();
  for (const debuffState of debuffStatesPerStep[n]) {
    valueTables[n].set(debuffKey(debuffState), buildValueTable(initialBoxes, maxFocus, maxFury, () => 1));
  }

  for (let k = n - 1; k >= 0; k--) {
    const atk = attacks[k];
    const nextTables = valueTables[k + 1];
    valueTables[k] = new Map();

    for (const debuffState of debuffStatesPerStep[k]) {
      const profile = profileFor(k, atk, debuffState);

      const valueAt: ValueLookup = (boxes, nextDebuffState, focus, fury) => {
        const table = nextTables.get(debuffKey(nextDebuffState));
        // Should always be present - computeReachableDebuffStates over-approximates, never under.
        return table ? readValueTable(table, boxes, focus, fury) : 0;
      };

      const table = buildValueTable(initialBoxes, maxFocus, maxFury, (boxes, focus, fury) => {
        let total = 0;
        for (const outcome of applyProfile(profile)) {
          const newDebuffState = applyStatEffectsForOutcome(debuffState, atk.statEffects, outcome.isCrit);
          const branches = bestAction(boxes, outcome.damageDealt, newDebuffState, focus, fury, toughRules, valueAt);
          total += outcome.probability * branchesValue(branches, valueAt);
        }
        return total;
      });

      valueTables[k].set(debuffKey(debuffState), table);
    }
  }

  // --- Forward simulation, replaying the policy above to get step-by-step stats ---
  interface FwdState {
    boxes: number;
    debuffState: DebuffState;
    focusLeft: number;
    furyLeft: number;
  }
  const fwdKey = (s: FwdState) => `${s.boxes}|${debuffKey(s.debuffState)}|${s.focusLeft}|${s.furyLeft}`;

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

  for (let k = 0; k < n; k++) {
    const atk = attacks[k];
    const nextTables = valueTables[k + 1];
    const valueAt: ValueLookup = (boxes, debuffState, focus, fury) => {
      const table = nextTables.get(debuffKey(debuffState));
      return table ? readValueTable(table, boxes, focus, fury) : 0;
    };

    const next = new Map<string, { state: FwdState; probability: number }>();
    let destroyedThisStep = 0;
    let hitMass = 0;
    let critMass = 0;
    let damageMass = 0;
    let aliveMass = 0;

    for (const { state, probability } of dist.values()) {
      aliveMass += probability;
      const profile = profileFor(k, atk, state.debuffState);

      for (const outcome of applyProfile(profile)) {
        const p = probability * outcome.probability;
        if (p <= 0) continue;
        if (outcome.isHit) hitMass += p;
        if (outcome.isCrit) critMass += p;
        damageMass += p * outcome.damageDealt;

        const newDebuffState = applyStatEffectsForOutcome(state.debuffState, atk.statEffects, outcome.isCrit);
        const branches = bestAction(
          state.boxes,
          outcome.damageDealt,
          newDebuffState,
          state.focusLeft,
          state.furyLeft,
          toughRules,
          valueAt
        );

        for (const b of branches) {
          const pp = p * b.probability;
          if (pp <= 0) continue;
          if (b.destroyed) {
            destroyedThisStep += pp;
            continue;
          }
          const fwd: FwdState = { boxes: b.boxes, debuffState: b.debuffState, focusLeft: b.focusLeft, furyLeft: b.furyLeft };
          const k2 = fwdKey(fwd);
          const existing = next.get(k2);
          if (existing) existing.probability += pp;
          else next.set(k2, { state: fwd, probability: pp });
        }
      }
    }

    cumulativeDestroy += destroyedThisStep;
    dist = next;

    const expectedBoxesRemaining = [...dist.values()].reduce(
      (acc, { state, probability }) => acc + state.boxes * probability,
      0
    );

    steps.push({
      attack: atk,
      hitChance: aliveMass > 0 ? hitMass / aliveMass : 0,
      critChance: aliveMass > 0 ? critMass / aliveMass : 0,
      averageDamage: aliveMass > 0 ? damageMass / aliveMass : 0,
      destroyChanceAtThisStep: destroyedThisStep,
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

  return { steps, finalDestroyChance: cumulativeDestroy, survivalDistribution };
}
