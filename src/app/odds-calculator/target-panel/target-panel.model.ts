import { WritableSignal, signal } from '@angular/core';
import { range } from '../range.util';

let nextSpellBonusId = 0;

export const DEF_OPTIONS: (number | 'KD')[] = ['KD', ...range(5, 25)];
export const ARM_OPTIONS = range(1, 35);
export const BOXES_OPTIONS = range(1, 99);
export const RESOURCE_OPTIONS = range(0, 15); // Focus/Fury point count
export const SHIELD_AMOUNT_OPTIONS = range(0, 10);
export const SPELL_BONUS_OPTIONS = range(0, 10); // 0 = "not granting this stat"
export const KOTD_OPTIONS = range(0, 10); // Knowledge of the Damned charge count (offensive/defensive)
export const SHIELD_GUARD_OPTIONS = range(0, 10);
export const SCAPEGOAT_OPTIONS = range(0, 4); // capped lower than every other resource here - see sequence.ts's MAX_SCAPEGOATS

/** 'off' means neither is active. Tough and Tough Steady are mutually exclusive - Tough Steady
 *  is strictly "Tough, but not negated by Knocked Down/Stationary" (see sequence.ts), so having
 *  both active at once would never make sense. */
export type ToughKind = 'off' | 'tough' | 'toughSteady';

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
 * One user-defined "custom effect" row - the generic escape hatch for the countless spells (and
 * feats/non-spell auras) that grant a DEF/ARM bonus or a special rule, which this app deliberately
 * doesn't try to enumerate by name (see docs). `name` is free text purely for the player's own
 * reference. A row is either a flat stat bonus (`kind: 'stat'`, one of `statType`/`statAmount`) or
 * a granted rule (`kind: 'rule'`, `ruleKind`) - never both at once, fixed at creation time by which
 * of `createStatSpellRow`/`createDispellableEffectRow` built it (there's no UI path to switch a
 * row's kind afterward). `dispellable` tags the entry as removable by an attack's Dispel effect
 * (see `sequence.ts`'s `*PostDispel` fields) - once an attack's Dispel fires, every entry still
 * flagged `dispellable` stops contributing for the rest of the sequence. A `'rule'` row is always
 * dispellable by construction (`createDispellableEffectRow` always sets it, with no checkbox to
 * change it): a permanent, non-dispellable rule should just be toggled directly in "Special rules"
 * instead of modeled here.
 */
export interface SpellBonusRow {
  readonly id: string;
  readonly name: WritableSignal<string>;
  readonly kind: WritableSignal<SpellBonusKind>;
  readonly statType: WritableSignal<SpellStatType>; // read only when kind === 'stat'
  readonly statAmount: WritableSignal<number>; // read only when kind === 'stat'
  /** Read only when kind === 'stat'. True = a genuine spell effect (an attack's Blessed ignores
   *  it); false = a non-spell source (a feat, a non-spell aura) Blessed never ignores - see
   *  `sequence.ts`'s `nonSpellArmBonus`/`nonSpellDefBonus`. Irrelevant for kind === 'rule' (a
   *  granted rule is never Blessed-ignorable regardless of source). */
  readonly isSpell: WritableSignal<boolean>;
  readonly ruleKind: WritableSignal<SpellRuleKind>; // read only when kind === 'rule'
  readonly dispellable: WritableSignal<boolean>;
}

/** "+ Add stat spell": a flat DEF/ARM bonus. `isSpell`/`dispellable` both default true (the
 *  common case - a spell-granted, dispellable bonus) - flip `isSpell` off for a non-spell source
 *  Blessed doesn't ignore (a feat, a non-spell aura), flip `dispellable` off for a permanent one. */
export function createStatSpellRow(): SpellBonusRow {
  return {
    id: `spell-${nextSpellBonusId++}`,
    name: signal(''),
    kind: signal<SpellBonusKind>('stat'),
    statType: signal<SpellStatType>('arm'),
    statAmount: signal(2),
    isSpell: signal(true),
    ruleKind: signal<SpellRuleKind>('unyielding'), // unused for a 'stat' row
    dispellable: signal(true),
  };
}

/** "+ Add dispellable effect": a granted rule (Tough/Unyielding), always dispellable by
 *  construction - an upkeep spell effect, never Blessed-ignorable regardless of source. */
export function createDispellableEffectRow(): SpellBonusRow {
  return {
    id: `spell-${nextSpellBonusId++}`,
    name: signal(''),
    kind: signal<SpellBonusKind>('rule'),
    statType: signal<SpellStatType>('arm'), // unused for a 'rule' row
    statAmount: signal(2), // unused for a 'rule' row
    isSpell: signal(true), // unused for a 'rule' row
    ruleKind: signal<SpellRuleKind>('unyielding'),
    dispellable: signal(true),
  };
}

/** The shared target's fields, each its own signal - same "signal per field" rationale as `AttackRow`. */
export interface TargetState {
  readonly def: WritableSignal<number | 'KD'>;
  readonly arm: WritableSignal<number>;
  readonly boxes: WritableSignal<number>;
  /** A model only ever has Focus (warcaster) or Fury (warlock), never both - two independent
   *  fields, but `TargetProfileDialog`'s `onFocusChange`/`onFuryChange` keep them mutually
   *  exclusive (setting one above 0 zeroes the other). */
  readonly focusPoints: WritableSignal<number>;
  readonly furyPoints: WritableSignal<number>;
  /** Offensive Knowledge of the Damned: a 0-10 pool of forced rerolls shared across EVERY attacker,
   *  spent via the same kind of fixed, no-lookahead rule Puppet Master uses - see
   *  `sequence.ts`'s `resolveKotdOffSplit`. */
  readonly offensiveKnowledgeOfTheDamned: WritableSignal<number>;
  /** Defensive Knowledge of the Damned: a 0-10 pool of forced rerolls the TARGET can spend against
   *  any attacker's attack or damage roll, chosen optimally with full sequence lookahead (like
   *  Focus/Fury) - see `sequence.ts`'s `resolveKotdDefChoice`. */
  readonly defensiveKnowledgeOfTheDamned: WritableSignal<number>;
  /** Shield Guards: a 0-10 pool of one-time blocks, each fully negating one RANGED attack (damage
   *  AND any effects it would have inflicted) - see `sequence.ts`'s `bestAction`. */
  readonly shieldGuards: WritableSignal<number>;
  /** Scapegoats: the melee-only mirror of `shieldGuards`, capped lower at 0-4 - see
   *  `SCAPEGOAT_OPTIONS`. */
  readonly scapegoats: WritableSignal<number>;
  readonly toughKind: WritableSignal<ToughKind>; // always succeeds on 5+ (no configurable threshold)
  /** Flat ARM bonus from Shield, 0-10 (0 = off) - see `shieldArmBonus`. */
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

const DEFAULT_DEF = 15;
const DEFAULT_ARM = 15;
const DEFAULT_BOXES = 15;

export function createTargetState(): TargetState {
  return {
    def: signal<number | 'KD'>(DEFAULT_DEF),
    arm: signal(DEFAULT_ARM),
    boxes: signal(DEFAULT_BOXES),
    focusPoints: signal(0),
    furyPoints: signal(0),
    offensiveKnowledgeOfTheDamned: signal(0),
    defensiveKnowledgeOfTheDamned: signal(0),
    shieldGuards: signal(0),
    scapegoats: signal(0),
    toughKind: signal<ToughKind>('off'),
    shieldAmount: signal(0),
    unyielding: signal(false),
    carapace: signal(false),
    rapidHealing: signal(false),
    spellBonuses: signal<SpellBonusRow[]>([]),
  };
}

export function resetTargetProfile(target: TargetState): void {
  target.focusPoints.set(0);
  target.furyPoints.set(0);
  target.offensiveKnowledgeOfTheDamned.set(0);
  target.defensiveKnowledgeOfTheDamned.set(0);
  target.shieldGuards.set(0);
  target.scapegoats.set(0);
  target.toughKind.set('off');
  target.shieldAmount.set(0);
  target.unyielding.set(false);
  target.carapace.set(false);
  target.rapidHealing.set(false);
  target.spellBonuses.set([]);
}

/** Full reset used by the hamburger menu's app-wide Reset action - unlike `resetTargetProfile`
 *  (which the Target profile pop-up's own Reset button uses, deliberately leaving DEF/ARM/Boxes
 *  untouched since those live outside that pop-up, on the Target row itself), this also restores
 *  DEF/ARM/Boxes to their defaults. */
export function resetTargetFully(target: TargetState): void {
  target.def.set(DEFAULT_DEF);
  target.arm.set(DEFAULT_ARM);
  target.boxes.set(DEFAULT_BOXES);
  resetTargetProfile(target);
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
  return target.shieldAmount();
}

function statSpells(target: TargetState, statType: SpellStatType, isSpell: boolean, dispellableOnly: boolean) {
  return target
    .spellBonuses()
    .filter(
      (s) =>
        s.kind() === 'stat' && s.statType() === statType && s.isSpell() === isSpell && (!dispellableOnly || !s.dispellable())
    );
}

function sumStatAmount(spells: SpellBonusRow[]): number {
  return spells.reduce((sum, s) => sum + s.statAmount(), 0);
}

/** Flat ARM bonus from every currently-active Stat-type bonus flagged Spell (Dispellable or not).
 *  Kept apart from `shieldArmBonus` so Blessed can ignore just this component. */
export function spellArmBonus(target: TargetState): number {
  return sumStatAmount(statSpells(target, 'arm', true, false));
}

/** Same, but counting only the spells NOT flagged Dispellable - what's left of `spellArmBonus`
 *  once some attack's Dispel effect has fired against this target. */
export function spellArmBonusPostDispel(target: TargetState): number {
  return sumStatAmount(statSpells(target, 'arm', true, true));
}

export function spellDefBonus(target: TargetState): number {
  return sumStatAmount(statSpells(target, 'def', true, false));
}

export function spellDefBonusPostDispel(target: TargetState): number {
  return sumStatAmount(statSpells(target, 'def', true, true));
}

/** Flat ARM bonus from every currently-active Stat-type bonus flagged non-spell (a feat, a
 *  non-spell aura). Unlike `spellArmBonus`, an attack's Blessed never ignores this - see
 *  `sequence.ts`'s `nonSpellArmBonus`. */
export function nonSpellArmBonus(target: TargetState): number {
  return sumStatAmount(statSpells(target, 'arm', false, false));
}

/** Same, but counting only the non-spell bonuses NOT flagged Dispellable. */
export function nonSpellArmBonusPostDispel(target: TargetState): number {
  return sumStatAmount(statSpells(target, 'arm', false, true));
}

export function nonSpellDefBonus(target: TargetState): number {
  return sumStatAmount(statSpells(target, 'def', false, false));
}

export function nonSpellDefBonusPostDispel(target: TargetState): number {
  return sumStatAmount(statSpells(target, 'def', false, true));
}

export interface TargetSummaryTag {
  /** Stable across a re-render even when `label` itself changes (e.g. adjusting Focus/Fury's
   *  point count, or switching Tough to Tough Steady, changes the text but not the identity of
   *  that one tag) - see `target-panel.html`'s `@for` tracking this instead of the label string
   *  itself, to avoid NG0956: tracking by the text would make Angular treat such a change as
   *  removing one tag and adding an unrelated one (destroying and recreating its DOM node)
   *  instead of just updating the existing node's text. A spell bonus tag uses the spell's own
   *  `id` (already stable, already used to `@for`-track the Spells list itself); every other tag
   *  is a fixed, known-in-advance capability, keyed by name. */
  readonly key: string;
  readonly label: string;
}

/** Short summary tags for every active target capability, shown under the DEF/ARM/Boxes row. */
export function targetSummary(target: TargetState): TargetSummaryTag[] {
  const tags: TargetSummaryTag[] = [];
  if (target.focusPoints() > 0) {
    tags.push({ key: 'resource', label: `Focus ${target.focusPoints()}` });
  } else if (target.furyPoints() > 0) {
    tags.push({ key: 'resource', label: `Fury ${target.furyPoints()}` });
  }
  if (target.offensiveKnowledgeOfTheDamned() > 0) {
    tags.push({ key: 'kotdOff', label: `Knowledge of the Damned (Off) ${target.offensiveKnowledgeOfTheDamned()}` });
  }
  if (target.defensiveKnowledgeOfTheDamned() > 0) {
    tags.push({ key: 'kotdDef', label: `Knowledge of the Damned (Def) ${target.defensiveKnowledgeOfTheDamned()}` });
  }
  if (target.shieldGuards() > 0) tags.push({ key: 'shieldGuards', label: `Shield Guards ${target.shieldGuards()}` });
  if (target.scapegoats() > 0) tags.push({ key: 'scapegoats', label: `Scapegoats ${target.scapegoats()}` });
  if (target.toughKind() === 'tough') tags.push({ key: 'tough', label: 'Tough' });
  if (target.toughKind() === 'toughSteady') tags.push({ key: 'tough', label: 'Tough Steady' });
  if (target.shieldAmount() > 0) tags.push({ key: 'shield', label: `Shield +${target.shieldAmount()} ARM` });
  if (target.unyielding()) tags.push({ key: 'unyielding', label: 'Unyielding' });
  if (target.carapace()) tags.push({ key: 'carapace', label: 'Carapace' });
  if (target.rapidHealing()) tags.push({ key: 'rapidHealing', label: 'Rapid Healing' });
  for (const spell of target.spellBonuses()) {
    const bonus =
      spell.kind() === 'stat'
        ? spell.statAmount() > 0
          ? `+${spell.statAmount()} ${spell.statType().toUpperCase()}`
          : ''
        : SPELL_RULE_LABELS[spell.ruleKind()];
    const name = spell.name().trim() || 'Spell';
    tags.push({ key: spell.id, label: `${name}${bonus ? ` (${bonus})` : ''}${spell.dispellable() ? ' [Up]' : ''}` });
  }
  return tags;
}
