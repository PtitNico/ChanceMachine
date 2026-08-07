import { DEF_FLOOR } from './constants';
import { StatEffect } from './types';

// --- Persistent target debuff state -----------------------------------------------------

export interface DebuffState {
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

export const INITIAL_DEBUFFS: DebuffState = {
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
export function isStationary(s: DebuffState): boolean {
  return s.stationary || s.iceCageStacks >= 2;
}

/** Knockdown and Stationary both auto-hit melee attacks and floor ranged/arcane DEF to 5 - see AttackType doc. */
export function isKnockedDownOrStationary(s: DebuffState): boolean {
  return s.knockedDown || isStationary(s);
}

/** DEF used for this target's to-hit roll, given its current debuffs. */
export function effectiveDef(baseDef: number, s: DebuffState): number {
  const floored = s.paralyzed || isKnockedDownOrStationary(s) ? DEF_FLOOR : baseDef;
  const flatPenalty = s.iceCageStacks * 2 + (s.shadowbind ? 3 : 0) + (s.blind ? 4 : 0) + (s.flare ? 2 : 0) + (s.weaken ? 2 : 0);
  return floored - flatPenalty;
}

export function debuffKey(s: DebuffState): string {
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

/** Applies every statEffect that fires for this outcome ("hit" effects fire on any hit, including
 *  crits; "crit" effects only on crits) - a MISS never applies anything, regardless of an
 *  effect's own trigger. `isHit` is required (not inferred from `isCrit`): a miss and a plain
 *  non-crit hit both have `isCrit === false`, so `isCrit` alone can't tell them apart - checking
 *  only `isCrit` here was a real bug (an "on hit" effect firing on a miss). */
export function applyStatEffectsForOutcome(s: DebuffState, statEffects: StatEffect[] | undefined, isHit: boolean, isCrit: boolean): DebuffState {
  if (!statEffects || statEffects.length === 0 || !isHit) return s;
  let next = s;
  for (const effect of statEffects) {
    const applies = effect.trigger === 'hit' || (effect.trigger === 'crit' && isCrit);
    if (applies) next = applyStatEffect(next, effect);
  }
  return next;
}
