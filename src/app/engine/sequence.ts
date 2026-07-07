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
 * Performance note: we do NOT branch into one probability tree per attack
 * (that would blow up combinatorially). Instead we track a small probability
 * distribution over the target's *state* (boxes remaining, Knocked Down
 * yes/no, focus/fury remaining) and fold each attack into it in turn. Each
 * attack's dice-pool enumeration (the expensive part) is done exactly ONCE
 * per attack via `buildAttackProfile`, then cheaply re-applied against every
 * surviving state - so ~10 attacks against a target with a few dozen
 * possible remaining-boxes values stays effectively instant.
 */

import {
  AttackProfile,
  AttackType,
  CriticalEffects,
  RollModifiers,
  applyProfile,
  buildAttackProfile,
} from './attack-model';

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
  criticalEffects?: CriticalEffects;
  /** Manual override: this attack automatically hits regardless of DEF (e.g. target is Stationary). */
  forceAutoHit?: boolean;
}

export interface SequenceTarget {
  /** Numeric DEF, or 'KD' if the target starts the whole sequence Knocked Down / unable to defend at all - every attack then auto-hits regardless of type, and DEF is never consulted. */
  def: number | 'KD';
  arm: number;
  boxes: number;
  tough?: boolean;
  toughOn?: number;
  /** Focus points the target can spend, one per attack, after damage is rolled: reduces that hit's damage by 5. */
  focusPoints?: number;
  /** Fury points the target can spend, one per attack, after damage is rolled: negates that hit's damage entirely (transferred to a warbeast). */
  furyPoints?: number;
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

/** One resolution of a single attack's damage against a state: probability-weighted possible next states. */
interface StateBranch {
  probability: number;
  boxes: number;
  knockedDown: boolean;
  focusLeft: number;
  furyLeft: number;
  destroyed: boolean;
}

type ValueLookup = (boxes: number, knockedDown: boolean, focusLeft: number, furyLeft: number) => number;

/** [boxes][knockedDown 0|1][focusLeft][furyLeft] -> probability of surviving everything this table represents. */
type ValueTable = number[][][][];

function buildValueTable(
  initialBoxes: number,
  maxFocus: number,
  maxFury: number,
  fill: (boxes: number, knockedDown: boolean, focusLeft: number, furyLeft: number) => number
): ValueTable {
  const table: ValueTable = [];
  for (let boxes = 0; boxes <= initialBoxes; boxes++) {
    table[boxes] = [[], []];
    for (let kd = 0; kd < 2; kd++) {
      const row: number[][] = [];
      for (let focus = 0; focus <= maxFocus; focus++) {
        row[focus] = [];
        for (let fury = 0; fury <= maxFury; fury++) {
          row[focus][fury] = fill(boxes, kd === 1, focus, fury);
        }
      }
      table[boxes][kd] = row;
    }
  }
  return table;
}

function readValueTable(
  table: ValueTable,
  boxes: number,
  knockedDown: boolean,
  focusLeft: number,
  furyLeft: number
): number {
  return table[boxes][knockedDown ? 1 : 0][focusLeft][furyLeft];
}

/** Applies a (possibly already-mitigated) damage value against the target's boxes, bifurcating on a Tough roll if lethal. */
function damageBranches(
  boxes: number,
  damageDealt: number,
  knockedDown: boolean,
  focusLeft: number,
  furyLeft: number,
  hasTough: boolean,
  toughFailChance: number
): StateBranch[] {
  const lethal = damageDealt >= boxes;
  if (!lethal) {
    return [{ probability: 1, boxes: boxes - damageDealt, knockedDown, focusLeft, furyLeft, destroyed: false }];
  }
  if (!hasTough) {
    return [{ probability: 1, boxes: 0, knockedDown, focusLeft, furyLeft, destroyed: true }];
  }
  // Tough simplification (see attack-model.ts): survives on 1 box and Knocked Down.
  return [
    { probability: 1 - toughFailChance, boxes: 1, knockedDown: true, focusLeft, furyLeft, destroyed: false },
    { probability: toughFailChance, boxes: 0, knockedDown, focusLeft, furyLeft, destroyed: true },
  ];
}

function branchesValue(branches: StateBranch[], valueAt: ValueLookup): number {
  return branches.reduce(
    (acc, b) => acc + b.probability * (b.destroyed ? 0 : valueAt(b.boxes, b.knockedDown, b.focusLeft, b.furyLeft)),
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
function outcomeScore(branches: StateBranch[], valueAt: ValueLookup): [number, number, number] {
  let survivalValue = 0;
  let survivalProbability = 0;
  let expectedBoxes = 0;
  for (const b of branches) {
    if (b.destroyed) continue;
    survivalValue += b.probability * valueAt(b.boxes, b.knockedDown, b.focusLeft, b.furyLeft);
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
  knockedDown: boolean,
  focusLeft: number,
  furyLeft: number,
  hasTough: boolean,
  toughFailChance: number,
  valueAt: ValueLookup
): StateBranch[] {
  let bestBranches = damageBranches(boxes, damageDealt, knockedDown, focusLeft, furyLeft, hasTough, toughFailChance);
  let bestScore = outcomeScore(bestBranches, valueAt);

  if (focusLeft > 0) {
    const branches = damageBranches(
      boxes,
      Math.max(0, damageDealt - FOCUS_DAMAGE_REDUCTION),
      knockedDown,
      focusLeft - 1,
      furyLeft,
      hasTough,
      toughFailChance
    );
    const score = outcomeScore(branches, valueAt);
    if (isBetterScore(score, bestScore)) {
      bestBranches = branches;
      bestScore = score;
    }
  }

  if (furyLeft > 0) {
    const branches = damageBranches(boxes, 0, knockedDown, focusLeft, furyLeft - 1, hasTough, toughFailChance);
    const score = outcomeScore(branches, valueAt);
    if (isBetterScore(score, bestScore)) {
      bestBranches = branches;
      bestScore = score;
    }
  }

  return bestBranches;
}

function buildProfileFor(atk: SequencedAttack, target: { def: number; arm: number }, autoHit: boolean): AttackProfile {
  return buildAttackProfile(
    { type: atk.type, stat: atk.stat, autoHit, modifiers: atk.modifiers },
    { pow: atk.pow, modifiers: atk.damageModifiers },
    target,
    atk.criticalEffects,
    autoHit
  );
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
  const hasTough = !!target.tough;
  const toughFailChance = hasTough ? ((target.toughOn ?? 5) - 1) / 6 : 0;
  const n = attacks.length;

  // A target already Knocked Down (DEF = 'KD') can't defend against anything - every
  // attack auto-hits regardless of type, and the numeric DEF is never consulted (the
  // dummy 0 below is only there to satisfy the profile builder's type; autoHit skips it).
  const alwaysAutoHit = target.def === 'KD';
  const profileTarget = { def: typeof target.def === 'number' ? target.def : 0, arm: target.arm };

  const attackInfos = attacks.map((atk) => {
    const forcedAutoHit = alwaysAutoHit || !!atk.forceAutoHit;
    const knockdownGates = !forcedAutoHit && atk.type === 'melee';
    const normalProfile = buildProfileFor(atk, profileTarget, forcedAutoHit);
    const autoHitProfile = knockdownGates ? buildProfileFor(atk, profileTarget, true) : normalProfile;
    return { atk, knockdownGates, normalProfile, autoHitProfile };
  });

  // --- Backward induction ---
  // valueTables[k] = P(survive attacks[k..n-1] onward | state), playing the
  // optimal focus/fury policy. valueTables[n] is the base case: no attacks
  // left, so any alive state has already survived.
  const valueTables: ValueTable[] = new Array(n + 1);
  valueTables[n] = buildValueTable(initialBoxes, maxFocus, maxFury, () => 1);

  for (let k = n - 1; k >= 0; k--) {
    const { atk, knockdownGates, normalProfile, autoHitProfile } = attackInfos[k];
    const nextTable = valueTables[k + 1];
    const valueAt: ValueLookup = (boxes, kd, focus, fury) => readValueTable(nextTable, boxes, kd, focus, fury);

    valueTables[k] = buildValueTable(initialBoxes, maxFocus, maxFury, (boxes, knockedDown, focus, fury) => {
      const usesAutoHit = alwaysAutoHit || !!atk.forceAutoHit || (knockdownGates && knockedDown);
      const profile = usesAutoHit ? autoHitProfile : normalProfile;
      let total = 0;
      for (const outcome of applyProfile(profile)) {
        const newKnockedDown = knockedDown || (!!atk.criticalEffects?.knockdown && outcome.isCrit);
        const branches = bestAction(
          boxes,
          outcome.damageDealt,
          newKnockedDown,
          focus,
          fury,
          hasTough,
          toughFailChance,
          valueAt
        );
        total += outcome.probability * branchesValue(branches, valueAt);
      }
      return total;
    });
  }

  // --- Forward simulation, replaying the policy above to get step-by-step stats ---
  interface FwdState {
    boxes: number;
    knockedDown: boolean;
    focusLeft: number;
    furyLeft: number;
  }
  const key = (s: FwdState) => `${s.boxes}|${s.knockedDown}|${s.focusLeft}|${s.furyLeft}`;

  let dist = new Map<string, { state: FwdState; probability: number }>();
  const initialState: FwdState = { boxes: initialBoxes, knockedDown: false, focusLeft: maxFocus, furyLeft: maxFury };
  dist.set(key(initialState), { state: initialState, probability: 1 });

  const steps: SequenceStepResult[] = [];
  let cumulativeDestroy = 0;

  for (let k = 0; k < n; k++) {
    const { atk, knockdownGates, normalProfile, autoHitProfile } = attackInfos[k];
    const nextTable = valueTables[k + 1];
    const valueAt: ValueLookup = (boxes, kd, focus, fury) => readValueTable(nextTable, boxes, kd, focus, fury);

    const next = new Map<string, { state: FwdState; probability: number }>();
    let destroyedThisStep = 0;
    let hitMass = 0;
    let critMass = 0;
    let damageMass = 0;
    let aliveMass = 0;

    for (const { state, probability } of dist.values()) {
      aliveMass += probability;
      const usesAutoHit = alwaysAutoHit || !!atk.forceAutoHit || (knockdownGates && state.knockedDown);
      const profile = usesAutoHit ? autoHitProfile : normalProfile;

      for (const outcome of applyProfile(profile)) {
        const p = probability * outcome.probability;
        if (p <= 0) continue;
        if (outcome.isHit) hitMass += p;
        if (outcome.isCrit) critMass += p;
        damageMass += p * outcome.damageDealt;

        const newKnockedDown = state.knockedDown || (!!atk.criticalEffects?.knockdown && outcome.isCrit);
        const branches = bestAction(
          state.boxes,
          outcome.damageDealt,
          newKnockedDown,
          state.focusLeft,
          state.furyLeft,
          hasTough,
          toughFailChance,
          valueAt
        );

        for (const b of branches) {
          const pp = p * b.probability;
          if (pp <= 0) continue;
          if (b.destroyed) {
            destroyedThisStep += pp;
            continue;
          }
          const fwd: FwdState = { boxes: b.boxes, knockedDown: b.knockedDown, focusLeft: b.focusLeft, furyLeft: b.furyLeft };
          const k2 = key(fwd);
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
