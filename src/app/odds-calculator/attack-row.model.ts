import { WritableSignal, signal } from '@angular/core';
import { AttackType, EffectTrigger } from '../engine/attack-model';
import { RofValue, SequencedAttack, StatEffect, StatEffectType } from '../engine/sequence';
import { range } from './range.util';

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
export const ARM_PENALTY_OPTIONS = range(1, 10);
/** Ranged-only "shots per attack" field - see `SequencedAttack.rof`'s doc comment. */
export const ROF_OPTIONS: RofValue[] = ['1', 'd3', '2d3'];

export const STAT_LABELS: Record<AttackType, string> = { melee: 'MAT', ranged: 'RAT', arcane: 'AAT' };

const STAT_EFFECT_TYPES: StatEffectType[] = [
  'knockdown',
  'stationary',
  'iceCage',
  'shadowbind',
  'blind',
  'paralysis',
  'flare',
  'weaken',
  'armPenalty',
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

/** Rendered as a PAIR of buttons, one in "On hit", one in "Critical" - see `TriggerEffectRow`. */
export const HIT_CRIT_PAIR_KEYS: TriggerEffectKey[] = ['armorPiercing', 'decapitation', ...STAT_EFFECT_TYPES];

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
  /** Only meaningful for 'armPenalty'. */
  readonly amount: WritableSignal<number>;
}

function createTriggerEffects(): TriggerEffectRow[] {
  return TRIGGER_EFFECT_KEYS.map((key) => ({ key, trigger: signal<EffectTrigger | 'off'>('off'), amount: signal(2) }));
}

function cloneTriggerEffects(source: TriggerEffectRow[]): TriggerEffectRow[] {
  return source.map((e) => ({ key: e.key, trigger: signal(e.trigger()), amount: signal(e.amount()) }));
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
  readonly stat: WritableSignal<number>;
  readonly diceCount: WritableSignal<number>;
  readonly pow: WritableSignal<number | '-'>;
  readonly damageDiceCount: WritableSignal<number>;
  /** Ranged-only "shots per attack" - ignored by the engine for melee/arcane rows regardless of
   *  this value, so switching Type away from Ranged and back doesn't need to reset it. */
  readonly rof: WritableSignal<RofValue>;

  /** Every toggleable effect on this attack - always one entry per `TRIGGER_EFFECT_KEYS` (a fixed
   *  set) - see `TriggerEffectRow`'s doc comment above. */
  readonly triggerEffects: TriggerEffectRow[];
}

export function createAttackRow(): AttackRow {
  return {
    id: `attack-${nextRowId++}`,
    type: signal<AttackType>('melee'),
    stat: signal(6),
    diceCount: signal(2),
    pow: signal<number | '-'>(12),
    damageDiceCount: signal(2),
    rof: signal<RofValue>('1'),
    triggerEffects: createTriggerEffects(),
  };
}

/** Copies another row's current values into a brand new row (fresh signals, not shared references). */
export function cloneAttackRow(source: AttackRow): AttackRow {
  return {
    id: `attack-${nextRowId++}`,
    type: signal(source.type()),
    stat: signal(source.stat()),
    diceCount: signal(source.diceCount()),
    pow: signal(source.pow()),
    damageDiceCount: signal(source.damageDiceCount()),
    rof: signal(source.rof()),
    triggerEffects: cloneTriggerEffects(source.triggerEffects),
  };
}

export function resetEffects(row: AttackRow): void {
  for (const effect of row.triggerEffects) {
    effect.trigger.set('off');
    effect.amount.set(2);
  }
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
  for (const effect of row.triggerEffects) {
    const trigger = effect.trigger();
    if (trigger === 'off') continue;
    let label = effect.key === 'armPenalty' ? `-${effect.amount()} ARM` : (SUMMARY_LABEL_OVERRIDES[effect.key] ?? TRIGGER_EFFECT_LABELS[effect.key]);
    if (trigger === 'crit') {
      label = `Crit ${label}`;
    }
    tags.push({ key: effect.key, label });
  }
  return tags;
}

/** Total dice picked by the user -> extra dice on top of the game's 2d6 baseline (never negative). */
function toBoostDice(diceCount: number): number {
  return Math.max(0, Math.floor(diceCount) - 2);
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

/** Projects one UI row into the plain object shape the engine expects. */
export function toSequencedAttack(row: AttackRow, index: number): SequencedAttack {
  const statEffects: StatEffect[] = row.triggerEffects
    .filter((e) => isStatEffectKey(e.key) && e.trigger() !== 'off')
    .map(
      (e): StatEffect => ({
        type: e.key as StatEffectType,
        trigger: e.trigger() as EffectTrigger,
        amount: e.key === 'armPenalty' ? e.amount() : undefined,
      })
    );

  return {
    id: row.id,
    attackerName: '',
    label: `Attack ${index + 1}`,
    type: row.type(),
    stat: row.stat(),
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
  };
}
