/**
 * sequence.ts
 * -----------
 * A full attack sequence: any number of attackers, each with any number of
 * attacks, applied IN ORDER against a single shared target. This is the
 * "assassination run" calculation - e.g. "will these 10 attacks combined
 * destroy that warjack?"
 *
 * Performance note: we do NOT branch into one probability tree per attack
 * (that would blow up combinatorially). Instead we track a small probability
 * distribution over the target's *state* (boxes remaining, Knocked Down
 * yes/no, destroyed yes/no) and fold each attack into it in turn. Each
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
  def: number;
  arm: number;
  boxes: number;
  tough?: boolean;
  toughOn?: number;
}

export interface SequenceStepResult {
  attack: SequencedAttack;
  /** Chance to hit for this attack, conditional on the target still being alive when it's made. */
  hitChance: number;
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

interface TargetState {
  boxes: number;
  knockedDown: boolean;
  destroyed: boolean;
}

type StateBucket = { state: TargetState; probability: number };

function stateKey(s: TargetState): string {
  return s.destroyed ? 'destroyed' : `${s.boxes}|${s.knockedDown}`;
}

function addState(map: Map<string, StateBucket>, state: TargetState, probability: number): void {
  if (probability <= 0) return;
  const key = stateKey(state);
  const existing = map.get(key);
  if (existing) {
    existing.probability += probability;
  } else {
    map.set(key, { state, probability });
  }
}

export function computeSequenceOdds(attacks: SequencedAttack[], target: SequenceTarget): SequenceResult {
  let dist = new Map<string, StateBucket>();
  addState(dist, { boxes: target.boxes, knockedDown: false, destroyed: false }, 1);

  const steps: SequenceStepResult[] = [];
  let cumulativeDestroy = 0;
  // Tough model simplification: a model that survives a Tough roll is left
  // on 1 remaining box (Tough is a single-wound-model rule in practice) and
  // is Knocked Down, per the standard Tough wording.
  const toughFailChance = target.tough ? ((target.toughOn ?? 5) - 1) / 6 : 0;

  for (const atk of attacks) {
    const knockdownAutoHitApplies = !atk.forceAutoHit && atk.type === 'melee';

    // Built once per attack, not once per state - see file header.
    const normalProfile = buildProfileFor(atk, target, !!atk.forceAutoHit);
    const autoHitProfile = knockdownAutoHitApplies ? buildProfileFor(atk, target, true) : normalProfile;

    const next = new Map<string, StateBucket>();
    let destroyedThisStep = 0;
    let hitMass = 0;
    let aliveMass = 0;

    for (const { state, probability } of dist.values()) {
      if (state.destroyed) {
        addState(next, state, probability);
        continue;
      }
      aliveMass += probability;

      const usesAutoHit = !!atk.forceAutoHit || (knockdownAutoHitApplies && state.knockedDown);
      const profile = usesAutoHit ? autoHitProfile : normalProfile;

      for (const o of applyProfile(profile)) {
        const p = probability * o.probability;
        if (o.isHit) hitMass += p;

        const newKnockedDown = state.knockedDown || (!!atk.criticalEffects?.knockdown && o.isCrit);
        const lethal = o.damageDealt >= state.boxes;

        if (!lethal) {
          addState(next, { boxes: state.boxes - o.damageDealt, knockedDown: newKnockedDown, destroyed: false }, p);
          continue;
        }

        if (target.tough) {
          destroyedThisStep += p * toughFailChance;
          addState(next, { boxes: 1, knockedDown: true, destroyed: false }, p * (1 - toughFailChance));
          addState(next, { boxes: 0, knockedDown: newKnockedDown, destroyed: true }, p * toughFailChance);
        } else {
          destroyedThisStep += p;
          addState(next, { boxes: 0, knockedDown: newKnockedDown, destroyed: true }, p);
        }
      }
    }

    cumulativeDestroy += destroyedThisStep;
    dist = next;

    const expectedBoxesRemaining = [...dist.values()].reduce(
      (acc, { state, probability }) => acc + (state.destroyed ? 0 : state.boxes) * probability,
      0
    );

    steps.push({
      attack: atk,
      hitChance: aliveMass > 0 ? hitMass / aliveMass : 0,
      destroyChanceAtThisStep: destroyedThisStep,
      cumulativeDestroyChance: cumulativeDestroy,
      expectedBoxesRemaining,
    });
  }

  const survivalDistribution = [...dist.values()]
    .filter(({ state }) => !state.destroyed)
    .map(({ state, probability }) => ({ boxes: state.boxes, probability }))
    .sort((a, b) => a.boxes - b.boxes);

  return { steps, finalDestroyChance: cumulativeDestroy, survivalDistribution };
}

function buildProfileFor(atk: SequencedAttack, target: SequenceTarget, autoHit: boolean): AttackProfile {
  return buildAttackProfile(
    { type: atk.type, stat: atk.stat, autoHit, modifiers: atk.modifiers },
    { pow: atk.pow, modifiers: atk.damageModifiers },
    target,
    atk.criticalEffects,
    autoHit
  );
}
