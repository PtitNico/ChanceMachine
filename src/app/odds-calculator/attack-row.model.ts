import { WritableSignal, signal } from '@angular/core';
import { AttackType, EffectTrigger } from '../engine/attack-model';
import { SequencedAttack, StatEffect, StatEffectType } from '../engine/sequence';
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

export const STAT_LABELS: Record<AttackType, string> = { melee: 'MAT', ranged: 'RAT', arcane: 'AAT' };

/**
 * Every effect that can fire on a hit or specifically on a crit, rendered as a pair of
 * toggle buttons (one in the "On hit" group, one in "On crit") - clicking one sets this
 * effect's trigger, clicking the already-active one turns the effect off. Armor Piercing
 * and Decapitation are one-off (this attack only); the rest are persistent `StatEffect`s.
 */
export type TriggerEffectKey = 'armorPiercing' | 'decapitation' | StatEffectType;

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
];

export const TRIGGER_EFFECT_KEYS: TriggerEffectKey[] = ['armorPiercing', 'decapitation', ...STAT_EFFECT_TYPES];

export const TRIGGER_EFFECT_LABELS: Record<TriggerEffectKey, string> = {
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
};

function isStatEffectKey(key: TriggerEffectKey): key is StatEffectType {
  return key !== 'armorPiercing' && key !== 'decapitation';
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
  readonly forceAutoHit: WritableSignal<boolean>;
  readonly pow: WritableSignal<number | '-'>;
  readonly damageDiceCount: WritableSignal<number>;

  // General.
  readonly jumpTheShark: WritableSignal<boolean>;

  // Attack roll.
  readonly discardAttackLowest: WritableSignal<boolean>;
  readonly discardAttackHighest: WritableSignal<boolean>;
  readonly rerollAttack: WritableSignal<boolean>;
  readonly sanguineFate: WritableSignal<boolean>;

  // Damage roll.
  readonly discardDamageLowest: WritableSignal<boolean>;
  readonly discardDamageHighest: WritableSignal<boolean>;
  readonly rerollDamage: WritableSignal<boolean>;
  readonly trash: WritableSignal<boolean>;
  readonly shatter: WritableSignal<boolean>;

  // Crit only.
  readonly brutalDamage: WritableSignal<boolean>;

  // Everything triggerable on a hit and/or a crit (fixed set, always present - see TriggerEffectRow).
  readonly triggerEffects: TriggerEffectRow[];
}

export function createAttackRow(): AttackRow {
  return {
    id: `attack-${nextRowId++}`,
    type: signal<AttackType>('melee'),
    stat: signal(6),
    diceCount: signal(2),
    forceAutoHit: signal(false),
    pow: signal<number | '-'>(12),
    damageDiceCount: signal(2),
    jumpTheShark: signal(false),
    discardAttackLowest: signal(false),
    discardAttackHighest: signal(false),
    rerollAttack: signal(false),
    sanguineFate: signal(false),
    discardDamageLowest: signal(false),
    discardDamageHighest: signal(false),
    rerollDamage: signal(false),
    trash: signal(false),
    shatter: signal(false),
    brutalDamage: signal(false),
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
    forceAutoHit: signal(source.forceAutoHit()),
    pow: signal(source.pow()),
    damageDiceCount: signal(source.damageDiceCount()),
    jumpTheShark: signal(source.jumpTheShark()),
    discardAttackLowest: signal(source.discardAttackLowest()),
    discardAttackHighest: signal(source.discardAttackHighest()),
    rerollAttack: signal(source.rerollAttack()),
    sanguineFate: signal(source.sanguineFate()),
    discardDamageLowest: signal(source.discardDamageLowest()),
    discardDamageHighest: signal(source.discardDamageHighest()),
    rerollDamage: signal(source.rerollDamage()),
    trash: signal(source.trash()),
    shatter: signal(source.shatter()),
    brutalDamage: signal(source.brutalDamage()),
    triggerEffects: cloneTriggerEffects(source.triggerEffects),
  };
}

export function resetEffects(row: AttackRow): void {
  row.forceAutoHit.set(false);
  row.jumpTheShark.set(false);
  row.discardAttackLowest.set(false);
  row.discardAttackHighest.set(false);
  row.rerollAttack.set(false);
  row.sanguineFate.set(false);
  row.discardDamageLowest.set(false);
  row.discardDamageHighest.set(false);
  row.rerollDamage.set(false);
  row.trash.set(false);
  row.shatter.set(false);
  row.brutalDamage.set(false);
  for (const effect of row.triggerEffects) {
    effect.trigger.set('off');
    effect.amount.set(2);
  }
}

/** Short "label (trigger)" summary strings for every active effect on a row, shown under the attack row. */
export function effectsSummary(row: AttackRow): string[] {
  const parts: string[] = [];
  if (row.forceAutoHit()) parts.push('Auto-hit');
  if (row.jumpTheShark()) parts.push('Jump the Shark');
  if (row.discardAttackLowest()) parts.push('Discard lowest (atk)');
  if (row.discardAttackHighest()) parts.push('Discard highest (atk)');
  if (row.rerollAttack()) parts.push('Reroll (atk)');
  if (row.sanguineFate()) parts.push('Sanguine Fate');
  if (row.discardDamageLowest()) parts.push('Discard lowest (dmg)');
  if (row.discardDamageHighest()) parts.push('Discard highest (dmg)');
  if (row.rerollDamage()) parts.push('Reroll (dmg)');
  if (row.trash()) parts.push('Trash');
  if (row.shatter()) parts.push('Shatter');
  if (row.brutalDamage()) parts.push('Crit Brutal Damage');
  for (const effect of row.triggerEffects) {
    const trigger = effect.trigger();
    if (trigger === 'off') continue;
    let label = effect.key === 'armPenalty' ? `-${effect.amount()} ARM` : TRIGGER_EFFECT_LABELS[effect.key];
    if (trigger === 'crit') {
      label = `Crit ${label}`;
    }
    parts.push(label);
  }
  return parts;
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
    modifiers: {
      boostDice: toBoostDice(row.diceCount()),
      discard: discardModifier(row.discardAttackLowest(), row.discardAttackHighest()),
      reroll: row.rerollAttack() || undefined,
      treatOnesAsSixes: row.jumpTheShark() || undefined,
      extraCritDice: row.sanguineFate() ? 1 : undefined,
    },
    pow: resolvePow(row.pow()),
    damageModifiers: {
      boostDice: toBoostDice(row.damageDiceCount()),
      discard: discardModifier(row.discardDamageLowest(), row.discardDamageHighest()),
      reroll: row.rerollDamage() || undefined,
      treatOnesAsSixes: row.jumpTheShark() || undefined,
    },
    effects: {
      brutalDamageDice: row.brutalDamage() ? 1 : undefined,
      armorPiercing: triggerOf(row, 'armorPiercing'),
      decapitation: triggerOf(row, 'decapitation'),
      trash: row.trash() || undefined,
      shatter: row.shatter() || undefined,
    },
    statEffects: statEffects.length > 0 ? statEffects : undefined,
    forceAutoHit: row.forceAutoHit(),
  };
}
