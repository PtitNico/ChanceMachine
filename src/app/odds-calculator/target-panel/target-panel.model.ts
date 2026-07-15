import { WritableSignal, signal } from '@angular/core';
import { range } from '../range.util';

let nextSpellBonusId = 0;

export const DEF_OPTIONS: (number | 'KD')[] = ['KD', ...range(5, 25)];
export const ARM_OPTIONS = range(1, 35);
export const BOXES_OPTIONS = range(1, 99);
export const RESOURCE_OPTIONS = range(0, 15); // Focus/Fury point count
export const SHIELD_AMOUNT_OPTIONS = range(1, 10);
export const SPELL_BONUS_OPTIONS = range(0, 10); // 0 = "not granting this stat"

/** 'off' means neither is active. Tough and Tough Steady are mutually exclusive - Tough Steady
 *  is strictly "Tough, but not negated by Knocked Down/Stationary" (see sequence.ts), so having
 *  both active at once would never make sense. */
export type ToughKind = 'off' | 'tough' | 'toughSteady';

/** A model only ever has Focus (warcaster) or Fury (warlock), never both - one shared point
 *  count with a toggle for which resource it represents, rather than two independent fields. */
export type ResourceKind = 'focus' | 'fury';

/** The special rules a spell can grant. Resolved by the engine exactly like the same rule
 *  toggled directly in "Special rules" (see `effectiveToughKind`/`effectiveUnyielding`/etc. below) -
 *  the type stays the full set of five so those helpers don't need a separate "spell-only" union,
 *  even though `SPELL_RULE_OPTIONS` (what the Rule <select> actually offers) is deliberately
 *  narrower - see its own comment. */
export type SpellRuleKind = 'tough' | 'toughSteady' | 'shield' | 'unyielding' | 'carapace';

/** Only Tough and Unyielding are common enough as spell-granted rules to offer here - Tough
 *  Steady, Shield, and Carapace are almost always innate model rules in practice, not
 *  spell-granted, so they're deliberately left off this list to keep the dropdown short. */
export const SPELL_RULE_OPTIONS: SpellRuleKind[] = ['tough', 'unyielding'];

export const SPELL_RULE_LABELS: Record<SpellRuleKind, string> = {
  tough: 'Tough',
  toughSteady: 'Tough Steady',
  shield: 'Shield',
  unyielding: 'Unyielding',
  carapace: 'Carapace',
};

export type SpellBonusKind = 'stat' | 'rule';
export type SpellStatType = 'def' | 'arm';

/**
 * One user-defined "spell bonus" row - the generic escape hatch for the countless spells that
 * grant a DEF/ARM bonus or a special rule, which this app deliberately doesn't try to enumerate
 * by name (see docs). `name` is free text purely for the player's own reference. A row is either
 * a flat stat bonus (`kind: 'stat'`, one of `statType`/`statAmount`) or a granted rule (`kind:
 * 'rule'`, `ruleKind`) - never both at once, since a single spell in the game grants one or the
 * other, not a mix. `dispellable` tags the entry as removable by an attack's Dispel effect (see
 * `sequence.ts`'s `*PostDispel` fields) - once an attack's Dispel fires, every entry still flagged
 * `dispellable` stops contributing for the rest of the sequence. A `'rule'` row is always
 * dispellable (enforced by `TargetProfileDialog.setSpellKind`): a permanent, non-dispellable
 * rule should just be toggled directly in "Special rules" instead of modeled as a spell.
 */
export interface SpellBonusRow {
  readonly id: string;
  readonly name: WritableSignal<string>;
  readonly kind: WritableSignal<SpellBonusKind>;
  readonly statType: WritableSignal<SpellStatType>;
  readonly statAmount: WritableSignal<number>;
  readonly ruleKind: WritableSignal<SpellRuleKind>;
  readonly dispellable: WritableSignal<boolean>;
}

export function createSpellBonusRow(): SpellBonusRow {
  return {
    id: `spell-${nextSpellBonusId++}`,
    name: signal(''),
    kind: signal<SpellBonusKind>('stat'),
    statType: signal<SpellStatType>('arm'),
    statAmount: signal(2),
    ruleKind: signal<SpellRuleKind>('unyielding'),
    dispellable: signal(true),
  };
}

/** The shared target's fields, each its own signal - same "signal per field" rationale as `AttackRow`. */
export interface TargetState {
  readonly def: WritableSignal<number | 'KD'>;
  readonly arm: WritableSignal<number>;
  readonly boxes: WritableSignal<number>;
  readonly resourceKind: WritableSignal<ResourceKind>;
  readonly resourcePoints: WritableSignal<number>;
  readonly toughKind: WritableSignal<ToughKind>; // always succeeds on 5+ (no configurable threshold)
  readonly shield: WritableSignal<boolean>;
  readonly shieldAmount: WritableSignal<number>;
  readonly unyielding: WritableSignal<boolean>;
  readonly carapace: WritableSignal<boolean>;
  /** Heals d3 boxes after any hit that deals nonzero damage without destroying the target - see
   *  `sequence.ts`'s `healBranches`. Turned off for the rest of the sequence by an attack's
   *  Grievous Wounds effect, not by anything toggled here. */
  readonly rapidHealing: WritableSignal<boolean>;
  /** Repeatable list of generic spell-granted stat bonuses/rules - see `SpellBonusRow`. */
  readonly spellBonuses: WritableSignal<SpellBonusRow[]>;
}

export function createTargetState(): TargetState {
  return {
    def: signal<number | 'KD'>(13),
    arm: signal(15),
    boxes: signal(5),
    resourceKind: signal<ResourceKind>('focus'),
    resourcePoints: signal(0),
    toughKind: signal<ToughKind>('off'),
    shield: signal(false),
    shieldAmount: signal(2),
    unyielding: signal(false),
    carapace: signal(false),
    rapidHealing: signal(false),
    spellBonuses: signal<SpellBonusRow[]>([]),
  };
}

export function resetTargetProfile(target: TargetState): void {
  target.resourceKind.set('focus');
  target.resourcePoints.set(0);
  target.toughKind.set('off');
  target.shield.set(false);
  target.unyielding.set(false);
  target.carapace.set(false);
  target.rapidHealing.set(false);
  target.spellBonuses.set([]);
}

function grantsRule(target: TargetState, rule: SpellRuleKind): boolean {
  return target.spellBonuses().some((s) => s.kind() === 'rule' && s.ruleKind() === rule);
}

/** A capability is active either because it's toggled directly (an innate model rule) or because
 *  some spell in the list grants it - the two sources are simply OR'd together. Once some attack's
 *  Dispel effect fires, the engine falls back to the raw innate signal alone (`target.unyielding()`/
 *  `target.carapace()`/`target.toughKind()`) instead of these - see `sequence.ts`'s `*PostDispel`
 *  fields: every rule grant here is spell-sourced, and every spell 'rule' row is always Dispellable
 *  by construction (see `SpellBonusRow`), so nothing from `grantsRule` ever survives Dispel. */
export function effectiveUnyielding(target: TargetState): boolean {
  return target.unyielding() || grantsRule(target, 'unyielding');
}

export function effectiveCarapace(target: TargetState): boolean {
  return target.carapace() || grantsRule(target, 'carapace');
}

/** Tough/Tough Steady stay mutually exclusive even once spell-granted rules are folded in: an
 *  innate toggle always wins, and a spell-granted Tough Steady wins over a spell-granted Tough. */
export function effectiveToughKind(target: TargetState): ToughKind {
  if (target.toughKind() !== 'off') return target.toughKind();
  if (grantsRule(target, 'toughSteady')) return 'toughSteady';
  if (grantsRule(target, 'tough')) return 'tough';
  return 'off';
}

/** Flat ARM bonus from Shield specifically - always the innate capability's bonus, since a
 *  spell-granted Shield isn't reachable from the current Rule dropdown (see `SPELL_RULE_OPTIONS`).
 *  Kept apart from `spellArmBonus` so Chain Weapon can ignore just this component (see
 *  `sequence.ts`'s `SequenceTarget.shieldArmBonus`). Unaffected by Dispel for the same reason. */
export function shieldArmBonus(target: TargetState): number {
  return target.shield() ? target.shieldAmount() : 0;
}

function statSpells(target: TargetState, statType: SpellStatType, dispellableOnly: boolean) {
  return target
    .spellBonuses()
    .filter((s) => s.kind() === 'stat' && s.statType() === statType && (!dispellableOnly || !s.dispellable()));
}

function sumStatAmount(spells: SpellBonusRow[]): number {
  return spells.reduce((sum, s) => sum + s.statAmount(), 0);
}

/** Flat ARM bonus from every currently-active Stat-type spell (Dispellable or not). Kept apart
 *  from `shieldArmBonus` so Blessed can ignore just this component. */
export function spellArmBonus(target: TargetState): number {
  return sumStatAmount(statSpells(target, 'arm', false));
}

/** Same, but counting only the spells NOT flagged Dispellable - what's left of `spellArmBonus`
 *  once some attack's Dispel effect has fired against this target. */
export function spellArmBonusPostDispel(target: TargetState): number {
  return sumStatAmount(statSpells(target, 'arm', true));
}

export function spellDefBonus(target: TargetState): number {
  return sumStatAmount(statSpells(target, 'def', false));
}

export function spellDefBonusPostDispel(target: TargetState): number {
  return sumStatAmount(statSpells(target, 'def', true));
}

/** Short summary strings for every active target capability, shown under the DEF/ARM/Boxes row. */
export function targetSummary(target: TargetState): string[] {
  const parts: string[] = [];
  if (target.resourcePoints() > 0) {
    parts.push(`${target.resourceKind() === 'focus' ? 'Focus' : 'Fury'} ${target.resourcePoints()}`);
  }
  if (target.toughKind() === 'tough') parts.push('Tough');
  if (target.toughKind() === 'toughSteady') parts.push('Tough Steady');
  if (target.shield()) parts.push(`Shield +${target.shieldAmount()} ARM`);
  if (target.unyielding()) parts.push('Unyielding');
  if (target.carapace()) parts.push('Carapace');
  if (target.rapidHealing()) parts.push('Rapid Healing');
  for (const spell of target.spellBonuses()) {
    const bonus =
      spell.kind() === 'stat'
        ? spell.statAmount() > 0
          ? `+${spell.statAmount()} ${spell.statType().toUpperCase()}`
          : ''
        : SPELL_RULE_LABELS[spell.ruleKind()];
    const name = spell.name().trim() || 'Spell';
    parts.push(`${name}${bonus ? ` (${bonus})` : ''}${spell.dispellable() ? ' [Up]' : ''}`);
  }
  return parts;
}
