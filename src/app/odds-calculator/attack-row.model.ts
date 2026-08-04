import { WritableSignal, signal } from '@angular/core';
import { AttackType, EffectTrigger } from '../engine/attack-model';
import { RofValue, SequencedAttack, StatEffect, StatEffectType } from '../engine/sequence';
import { range } from './range.util';
import { Target } from './target-panel/target-panel.model';

let nextRowId = 0;

/** A POW of '-' means the attack deals no damage at all (a utility attack whose only
 *  purpose is a critical effect, e.g. Knockdown) - still resolved as a normal to-hit
 *  roll (so it can still crit), just mapped to a POW low enough that damage always
 *  floors at 0 regardless of dice or ARM. */
const NO_DAMAGE_POW = -9999;
function resolvePow(pow: number | '-'): number {
  return pow === '-' ? NO_DAMAGE_POW : pow;
}

export function parsePow(raw: string): number | '-' {
  return raw === '-' ? '-' : Number(raw);
}

export const STAT_OPTIONS = range(0, 20); // MAT / RAT / AAT
export const POW_OPTIONS: (number | '-')[] = ['-', ...range(0, 30)];
export const DICE_OPTIONS = range(1, 6);
export const ARM_PENALTY_OPTIONS = range(0, 10); // 0 = off - see AttackRow's armPenaltyHitAmount/armPenaltyCritAmount
/** How many times a weapon fires, guaranteed - see `SequencedAttack.attackCount`'s doc comment. */
export const ATTACK_COUNT_OPTIONS = range(1, 10);
/** Same field, but for a RANGED weapon specifically: 0 is allowed here (unlike melee/arcane's
 *  `ATTACK_COUNT_OPTIONS`), since a ranged weapon can rely entirely on `rof`'s random extra shots
 *  with no guaranteed base of its own (e.g. a pure ROF sprayer). Shown merged with `ROF_OPTIONS`
 *  under one "# Atks" label - see `AttackSubCard`. */
export const RANGED_ATTACK_COUNT_OPTIONS = range(0, 10);
/** Ranged-only "extra shots on top of # Atks" field - see `SequencedAttack.rof`'s doc comment. */
export const ROF_OPTIONS: RofValue[] = ['-', 'd3', '2d3'];

export const STAT_LABELS: Record<AttackType, string> = { melee: 'MAT', ranged: 'RAT', arcane: 'AAT' };
/** Shown next to Type everywhere it appears - the attack sub-card's own type indicator and the
 *  attack-edit pop-up's Type select options alike. */
export const TYPE_EMOJI: Record<AttackType, string> = { melee: '🗡️', ranged: '🏹', arcane: '🪄' };

/** 'armPenalty' is deliberately excluded here - unlike every other entry, it has a genuinely
 *  user-editable amount, so it's modeled as its own pair of fields on `AttackRow`
 *  (`armPenaltyHitAmount`/`armPenaltyCritAmount`) rather than through the generic
 *  `TriggerEffectRow` system this array drives - see `AttackRow`'s doc comment. */
const STAT_EFFECT_TYPES: StatEffectType[] = [
  'knockdown',
  'stationary',
  'iceCage',
  'shadowbind',
  'blind',
  'paralysis',
  'flare',
  'weaken',
  'dispel',
  'grievousWounds',
];

/**
 * Every toggleable effect on an attack row - general, attack-roll, damage-roll, crit-only, and
 * genuinely triggered-on-hit-or-crit alike - is one `TriggerEffectRow`, all stored together in
 * `AttackRow.triggerEffects`. Most of these have no real hit/crit distinction at all (Jump the
 * Shark, Discard lowest, Trash, ...) - for those, `'hit'` is simply the interface's generic "on"
 * value, and the UI only ever offers ONE button for them (`ToggleButton` with its default
 * `activeValue="hit"`). Only Armor Piercing, Decapitation, and the persistent `StatEffect`s
 * genuinely distinguish "on a hit" from "on a critical hit", rendered as a PAIR of buttons (one
 * per group) both bound to the SAME `TriggerEffectRow` with a different `activeValue`. Sharing one
 * shape across both cases - rather than a separate plain `WritableSignal<boolean>` per simple
 * effect - is what let a single `ToggleButton` component replace every repeated toggle-button
 * block that used to be hand-written per effect.
 */
export type TriggerEffectKey =
  | 'jumpTheShark'
  | 'blessed'
  | 'forceAutoHit'
  | 'discardAttackLowest'
  | 'discardAttackHighest'
  | 'rerollAttack'
  | 'sanguineFate'
  | 'discardDamageLowest'
  | 'discardDamageHighest'
  | 'rerollDamage'
  | 'trash'
  | 'shatter'
  | 'chainWeapon'
  | 'brutalDamage'
  | 'criticalShred'
  | 'sustainedAttack'
  | 'armorPiercing'
  | 'decapitation'
  | StatEffectType;

/** Rendered in the Effects dialog's "General" section, each as a single simple toggle. */
export const GENERAL_EFFECT_KEYS: TriggerEffectKey[] = ['jumpTheShark', 'blessed'];

/** Rendered in the "Attack" section, each as a single simple toggle. */
export const ATTACK_EFFECT_KEYS: TriggerEffectKey[] = [
  'forceAutoHit',
  'discardAttackLowest',
  'discardAttackHighest',
  'rerollAttack',
  'sanguineFate',
];

/** Rendered in the "Damage" section, each as a single simple toggle. */
export const DAMAGE_EFFECT_KEYS: TriggerEffectKey[] = [
  'discardDamageLowest',
  'discardDamageHighest',
  'rerollDamage',
  'trash',
  'shatter',
  'chainWeapon',
];

/** Rendered as a PAIR of buttons, one in "On hit", one in "Critical" - see `TriggerEffectRow`.
 *  `sustainedAttack` triggering on a hit vs. specifically on a crit is a genuine hit/crit choice
 *  (unlike Brutal Damage/Shred below, which have no "on hit" variant at all), so it's a pair key
 *  like Armor Piercing/Decapitation rather than a `CRIT_ONLY_SIMPLE_KEYS` entry - the two buttons
 *  share one `TriggerEffectRow`, so activating one is mutually exclusive with the other for free. */
export const HIT_CRIT_PAIR_KEYS: TriggerEffectKey[] = ['armorPiercing', 'decapitation', 'sustainedAttack', ...STAT_EFFECT_TYPES];

/** Rendered in the "Critical" section too, but (unlike `HIT_CRIT_PAIR_KEYS`) as a single simple
 *  toggle each - neither has an "on hit" variant at all. */
export const CRIT_ONLY_SIMPLE_KEYS: TriggerEffectKey[] = ['brutalDamage', 'criticalShred'];

export const TRIGGER_EFFECT_KEYS: TriggerEffectKey[] = [
  ...GENERAL_EFFECT_KEYS,
  ...ATTACK_EFFECT_KEYS,
  ...DAMAGE_EFFECT_KEYS,
  ...HIT_CRIT_PAIR_KEYS,
  ...CRIT_ONLY_SIMPLE_KEYS,
];

export const TRIGGER_EFFECT_LABELS: Record<TriggerEffectKey, string> = {
  jumpTheShark: 'Jump the Shark',
  blessed: 'Blessed',
  forceAutoHit: 'Auto-hit',
  discardAttackLowest: 'Discard lowest',
  discardAttackHighest: 'Discard highest',
  rerollAttack: 'Reroll',
  sanguineFate: 'Sanguine Fate',
  discardDamageLowest: 'Discard lowest',
  discardDamageHighest: 'Discard highest',
  rerollDamage: 'Reroll',
  trash: 'Trash',
  shatter: 'Shatter',
  chainWeapon: 'Chain Weapon',
  brutalDamage: 'Brutal Damage',
  criticalShred: 'Shred',
  sustainedAttack: 'Sustained Attack',
  armorPiercing: 'Armor Piercing',
  decapitation: 'Decapitation',
  knockdown: 'Knockdown',
  stationary: 'Stationary',
  iceCage: 'Ice Cage (-2 DEF)',
  shadowbind: 'Shadowbind (-3 DEF)',
  blind: 'Blind (-4 DEF)',
  paralysis: 'Paralysis (DEF 5)',
  flare: 'Flare (-2 DEF)',
  weaken: 'Weaken (-2 DEF)',
  armPenalty: '-X ARM',
  dispel: 'Dispel',
  grievousWounds: 'Grievous Wounds',
};

/** Where a summary tag's text needs to differ from the button's own label (mainly to disambiguate
 *  the attack-roll/damage-roll pairs sharing a label, e.g. both "Discard lowest" buttons) - see
 *  `effectsSummary`. Anything not listed here just reuses `TRIGGER_EFFECT_LABELS` verbatim. */
const SUMMARY_LABEL_OVERRIDES: Partial<Record<TriggerEffectKey, string>> = {
  discardAttackLowest: 'Discard lowest (atk)',
  discardAttackHighest: 'Discard highest (atk)',
  rerollAttack: 'Reroll (atk)',
  discardDamageLowest: 'Discard lowest (dmg)',
  discardDamageHighest: 'Discard highest (dmg)',
  rerollDamage: 'Reroll (dmg)',
  brutalDamage: 'Crit Brutal Damage',
  criticalShred: 'Crit Shred',
};

function isStatEffectKey(key: TriggerEffectKey): key is StatEffectType {
  return (STAT_EFFECT_TYPES as TriggerEffectKey[]).includes(key);
}

/** 'off' means this effect isn't active on this attack. */
export interface TriggerEffectRow {
  readonly key: TriggerEffectKey;
  readonly trigger: WritableSignal<EffectTrigger | 'off'>;
}

function createTriggerEffects(): TriggerEffectRow[] {
  return TRIGGER_EFFECT_KEYS.map((key) => ({ key, trigger: signal<EffectTrigger | 'off'>('off') }));
}

function cloneTriggerEffects(source: TriggerEffectRow[]): TriggerEffectRow[] {
  return source.map((e) => ({ key: e.key, trigger: signal(e.trigger()) }));
}

/** Every `TriggerEffectRow` from `row.triggerEffects` matching `keys`, in `keys`' own order - the
 *  Effects dialog template uses this to pull just the subset relevant to a given section (see
 *  `GENERAL_EFFECT_KEYS` and friends above). Every key in `TRIGGER_EFFECT_KEYS` is always present
 *  in `row.triggerEffects` (a fixed set created once per row), so this never needs to filter out
 *  a miss. */
export function effectsFor(row: AttackRow, keys: readonly TriggerEffectKey[]): TriggerEffectRow[] {
  return keys.map((key) => row.triggerEffects.find((e) => e.key === key)!);
}

/**
 * One editable row in the attack sequence builder. Each field is its own
 * signal (rather than one signal holding a plain object) so that editing a
 * single field doesn't require cloning the whole row - `toSequencedAttack`
 * and each row-scoped component just read whichever signals they need.
 *
 * `diceCount` / `damageDiceCount` are the TOTAL number of d6 rolled (2 by
 * default, matching the game's baseline) rather than a boost count on top of
 * a hidden base - the user just picks the number of dice they're rolling.
 */
export interface AttackRow {
  readonly id: string;
  readonly type: WritableSignal<AttackType>;
  readonly diceCount: WritableSignal<number>;
  readonly pow: WritableSignal<number | '-'>;
  readonly damageDiceCount: WritableSignal<number>;
  /** How many times this weapon fires, guaranteed (1-10) - independent of `rof`'s additional
   *  random shots on top. Applies to every attack type, unlike `rof` (ranged-only). */
  readonly attackCount: WritableSignal<number>;
  /** Ranged-only "extra shots on top of `attackCount`" - ignored by the engine for melee/arcane
   *  rows regardless of this value, so switching Type away from Ranged and back doesn't need to
   *  reset it. */
  readonly rof: WritableSignal<RofValue>;

  /** "-X ARM" (generic persistent ARM debuff): two independent 0-10 counters (0 = off), one per
   *  trigger timing, each its own `<app-toggle-select>` in the Effects pop-up's "On hit"/"Critical"
   *  section - mutually exclusive by convention (`AttackEditDialog`'s `onArmPenaltyHitChange`/
   *  `onArmPenaltyCritChange`), the same "two fields kept exclusive at the call site" shape
   *  `TargetState.focusPoints`/`furyPoints` uses. Kept OUT of the generic `triggerEffects`/
   *  `TriggerEffectRow` system (unlike every other hit/crit-pair effect above) because it's the
   *  one effect here with a genuinely user-editable amount, which `TriggerEffectRow` has no field
   *  for. */
  readonly armPenaltyHitAmount: WritableSignal<number>;
  readonly armPenaltyCritAmount: WritableSignal<number>;

  /** Every toggleable effect on this attack - always one entry per `TRIGGER_EFFECT_KEYS` (a fixed
   *  set) - see `TriggerEffectRow`'s doc comment above. */
  readonly triggerEffects: TriggerEffectRow[];

  /** Which targets (by stable `Target.id`, not index - a target's own position can shift when an
   *  earlier one is removed) this weapon is in range of - `null` means every target (the default).
   *  Resolved into `SequencedAttack.eligibleTargetIndices` at compute time by `toSequencedAttack`,
   *  looking each id up in the CURRENT targets list, mirroring how `attackerIndex` is resolved
   *  fresh from the row's parent `Attacker` rather than stored on the row itself. */
  readonly eligibleTargetIds: WritableSignal<string[] | null>;
}

export function createAttackRow(): AttackRow {
  return {
    id: `attack-${nextRowId++}`,
    type: signal<AttackType>('melee'),
    diceCount: signal(2),
    pow: signal<number | '-'>(12),
    damageDiceCount: signal(2),
    attackCount: signal(1),
    rof: signal<RofValue>('-'),
    armPenaltyHitAmount: signal(0),
    armPenaltyCritAmount: signal(0),
    triggerEffects: createTriggerEffects(),
    eligibleTargetIds: signal<string[] | null>(null),
  };
}

/** Copies another row's current values into a brand new row (fresh signals, not shared references). */
export function cloneAttackRow(source: AttackRow): AttackRow {
  return {
    id: `attack-${nextRowId++}`,
    type: signal(source.type()),
    diceCount: signal(source.diceCount()),
    pow: signal(source.pow()),
    damageDiceCount: signal(source.damageDiceCount()),
    attackCount: signal(source.attackCount()),
    rof: signal(source.rof()),
    armPenaltyHitAmount: signal(source.armPenaltyHitAmount()),
    armPenaltyCritAmount: signal(source.armPenaltyCritAmount()),
    triggerEffects: cloneTriggerEffects(source.triggerEffects),
    eligibleTargetIds: signal(source.eligibleTargetIds()),
  };
}

export function resetEffects(row: AttackRow): void {
  for (const effect of row.triggerEffects) {
    effect.trigger.set('off');
  }
  row.armPenaltyHitAmount.set(0);
  row.armPenaltyCritAmount.set(0);
}

/** Short "label (trigger)" summary strings for every active effect on a row, shown under the attack row. */
export interface EffectSummaryTag {
  /** Stable across a re-render even when `label` itself changes (e.g. switching an effect from
   *  "on crit" to "on hit" changes its text but not its identity) - see `attack-row.html`'s
   *  `@for` tracking this instead of the label string itself, to avoid NG0956: tracking by the
   *  text would make Angular treat that switch as removing one tag and adding an unrelated one
   *  (destroying and recreating its DOM node) instead of just updating the existing node's text. */
  readonly key: TriggerEffectKey;
  readonly label: string;
}

export function effectsSummary(row: AttackRow): EffectSummaryTag[] {
  const tags: EffectSummaryTag[] = [];
  if (row.armPenaltyHitAmount() > 0) {
    tags.push({ key: 'armPenalty', label: `-${row.armPenaltyHitAmount()} ARM` });
  } else if (row.armPenaltyCritAmount() > 0) {
    tags.push({ key: 'armPenalty', label: `Crit -${row.armPenaltyCritAmount()} ARM` });
  }
  for (const effect of row.triggerEffects) {
    const trigger = effect.trigger();
    if (trigger === 'off') continue;
    let label = SUMMARY_LABEL_OVERRIDES[effect.key] ?? TRIGGER_EFFECT_LABELS[effect.key];
    if (trigger === 'crit') {
      label = `Crit ${label}`;
    }
    tags.push({ key: effect.key, label });
  }
  return tags;
}

/** Total dice picked by the user -> offset from the engine's 2d6 baseline (`BASE_DICE` in
 *  attack-model.ts) - genuinely NEGATIVE for `diceCount < 2` (1 is a valid, real dice pool, e.g.
 *  DICE_OPTIONS' own floor), not clamped to 0. Clamping this to 0 was a bug: it silently made
 *  picking "1" roll 2d6 anyway, identical to picking "2" - `attack-model.ts`'s own dice-pool math
 *  (`isHitOutcome`'s single-die special case, `rollDicePool`'s `diceCount < 1` guard) already
 *  correctly supports a genuine 1-die roll, so nothing downstream needed to change once this
 *  stopped throwing the negative value away. */
function toBoostDice(diceCount: number): number {
  return Math.floor(diceCount) - 2;
}

function discardModifier(lowest: boolean, highest: boolean): { highest?: number; lowest?: number } | undefined {
  if (!lowest && !highest) return undefined;
  return { highest: highest ? 1 : undefined, lowest: lowest ? 1 : undefined };
}

function triggerOf(row: AttackRow, key: TriggerEffectKey): EffectTrigger | undefined {
  const trigger = row.triggerEffects.find((e) => e.key === key)?.trigger();
  return trigger && trigger !== 'off' ? trigger : undefined;
}

/** Whether a simple (non hit/crit) effect is currently active - i.e. its trigger isn't 'off'. */
function isEffectOn(row: AttackRow, key: TriggerEffectKey): boolean {
  return triggerOf(row, key) !== undefined;
}

/** Projects one UI row into the plain object shape the engine expects. `stat`/`attackerName` are
 *  no longer the row's own values - they live on the parent `Attacker` now (`statFor`/
 *  `attackerDisplayName` in `attacker.model.ts`), resolved by the caller and passed in here.
 *  `attackerIndex`/`hasPuppetMaster` are the same idea for Puppet Master's shared reroll token -
 *  see `sequence.ts`'s `SequencedAttack` doc comment for why `attackerIndex`, not `attackerName`,
 *  is the grouping key. `targets` resolves `row.eligibleTargetIds` (stable ids) into
 *  `eligibleTargetIndices` (the engine's own index-based key) by looking each id up in the
 *  CURRENT targets list - same "resolve stable id to current position at compute time" pattern. */
export function toSequencedAttack(
  row: AttackRow,
  index: number,
  stat: number,
  attackerName: string,
  attackerIndex: number,
  hasPuppetMaster: boolean,
  targets: Target[]
): SequencedAttack {
  const eligibleTargetIds = row.eligibleTargetIds();
  const eligibleTargetIndices = eligibleTargetIds
    ? eligibleTargetIds.map((id) => targets.findIndex((t) => t.id === id)).filter((i) => i >= 0)
    : undefined;
  const statEffects: StatEffect[] = row.triggerEffects
    .filter((e) => isStatEffectKey(e.key) && e.trigger() !== 'off')
    .map((e): StatEffect => ({ type: e.key as StatEffectType, trigger: e.trigger() as EffectTrigger }));
  if (row.armPenaltyHitAmount() > 0) {
    statEffects.push({ type: 'armPenalty', trigger: 'hit', amount: row.armPenaltyHitAmount() });
  } else if (row.armPenaltyCritAmount() > 0) {
    statEffects.push({ type: 'armPenalty', trigger: 'crit', amount: row.armPenaltyCritAmount() });
  }

  return {
    id: row.id,
    attackerName,
    label: `Attack ${index + 1}`,
    type: row.type(),
    stat,
    attackCount: row.attackCount(),
    rof: row.rof(),
    modifiers: {
      boostDice: toBoostDice(row.diceCount()),
      discard: discardModifier(isEffectOn(row, 'discardAttackLowest'), isEffectOn(row, 'discardAttackHighest')),
      reroll: isEffectOn(row, 'rerollAttack') || undefined,
      treatOnesAsSixes: isEffectOn(row, 'jumpTheShark') || undefined,
      extraCritDice: isEffectOn(row, 'sanguineFate') ? 1 : undefined,
    },
    pow: resolvePow(row.pow()),
    damageModifiers: {
      boostDice: toBoostDice(row.damageDiceCount()),
      discard: discardModifier(isEffectOn(row, 'discardDamageLowest'), isEffectOn(row, 'discardDamageHighest')),
      reroll: isEffectOn(row, 'rerollDamage') || undefined,
      treatOnesAsSixes: isEffectOn(row, 'jumpTheShark') || undefined,
    },
    effects: {
      brutalDamageDice: isEffectOn(row, 'brutalDamage') ? 1 : undefined,
      armorPiercing: triggerOf(row, 'armorPiercing'),
      decapitation: triggerOf(row, 'decapitation'),
      trash: isEffectOn(row, 'trash') || undefined,
      shatter: isEffectOn(row, 'shatter') || undefined,
    },
    statEffects: statEffects.length > 0 ? statEffects : undefined,
    forceAutoHit: isEffectOn(row, 'forceAutoHit'),
    blessed: isEffectOn(row, 'blessed') || undefined,
    chainWeapon: isEffectOn(row, 'chainWeapon') || undefined,
    criticalShred: isEffectOn(row, 'criticalShred') || undefined,
    sustainedAttack: triggerOf(row, 'sustainedAttack'),
    attackerIndex,
    hasPuppetMaster: hasPuppetMaster || undefined,
    eligibleTargetIndices,
  };
}
