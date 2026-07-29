import { WritableSignal, signal } from '@angular/core';
import { range } from '../range.util';

export const DEF_OPTIONS: (number | 'KD')[] = ['KD', ...range(5, 25)];
export const ARM_OPTIONS = range(1, 35);
export const BOXES_OPTIONS = range(1, 99);
export const RESOURCE_OPTIONS = range(0, 15); // Focus/Fury point count
export const SHIELD_AMOUNT_OPTIONS = range(0, 4);
export const SPELL_BONUS_OPTIONS = range(0, 6); // 0 = "not granting this stat"
export const KOTD_OPTIONS = range(0, 10); // Knowledge of the Damned charge count (offensive/defensive)
export const SHIELD_GUARD_OPTIONS = range(0, 10);
export const SCAPEGOAT_OPTIONS = range(0, 4); // capped lower than every other resource here - see sequence.ts's MAX_SCAPEGOATS

/** 'off' means neither is active. Tough and Tough Steady are mutually exclusive - Tough Steady
 *  is strictly "Tough, but not negated by Knocked Down/Stationary" (see sequence.ts), so having
 *  both active at once would never make sense. */
export type ToughKind = 'off' | 'tough' | 'toughSteady';

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
  /** "Dispellable special rules": the same Tough/Unyielding grants as the plain toggles above, but
   *  removable by an attack's Dispel effect (an upkeep spell, unlike the permanent toggles) -
   *  OR'd into `effectiveToughKind`/`effectiveUnyielding` below, read directly (ignored) once
   *  Dispel fires, exactly like every other pre/post-Dispel pair on this interface. */
  readonly dispellableTough: WritableSignal<boolean>;
  readonly dispellableUnyielding: WritableSignal<boolean>;
  /** Heals d3 boxes after any hit that deals nonzero damage without destroying the target - see
   *  `sequence.ts`'s `healBranches`. Turned off for the rest of the sequence by an attack's
   *  Grievous Wounds effect, not by anything toggled here. */
  readonly rapidHealing: WritableSignal<boolean>;
  /** Flat DEF/ARM bonuses from spells, 0-10 each (0 = off) - the generic escape hatch for the
   *  countless spells this app deliberately doesn't try to enumerate by name (see docs). Two
   *  categories, each its own pair of fields rather than a repeatable named list (an earlier
   *  version had one - see `spellArmBonus`'s doc comment for why that was dropped): a "Spell" bonus
   *  is permanent for the sequence (Dispel can't remove it - a one-shot effect already resolved),
   *  an "Upkeep spell / Animus" bonus is removable by an attack's Dispel effect (see
   *  `spellArmBonusPostDispel` below) - both are always Blessed-ignorable, since both are
   *  genuinely spell-sourced by construction (there's no non-spell/feat bonus modeled anymore). */
  readonly spellDefAmount: WritableSignal<number>;
  readonly spellArmAmount: WritableSignal<number>;
  readonly upkeepSpellDefAmount: WritableSignal<number>;
  readonly upkeepSpellArmAmount: WritableSignal<number>;
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
    dispellableTough: signal(false),
    dispellableUnyielding: signal(false),
    rapidHealing: signal(false),
    spellDefAmount: signal(0),
    spellArmAmount: signal(0),
    upkeepSpellDefAmount: signal(0),
    upkeepSpellArmAmount: signal(0),
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
  target.dispellableTough.set(false);
  target.dispellableUnyielding.set(false);
  target.rapidHealing.set(false);
  target.spellDefAmount.set(0);
  target.spellArmAmount.set(0);
  target.upkeepSpellDefAmount.set(0);
  target.upkeepSpellArmAmount.set(0);
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

/** A capability is active either because it's toggled directly (permanent) or because
 *  `dispellableUnyielding`/`dispellableTough` grants it (an upkeep spell) - the two sources are
 *  simply OR'd together. Once some attack's Dispel effect fires, the engine falls back to the raw
 *  permanent signal alone (`target.unyielding()`/`target.toughKind()`) instead of these - see
 *  `sequence.ts`'s `*PostDispel` fields: `dispellableUnyielding`/`dispellableTough` are, by
 *  definition, always what Dispel removes, so nothing from them ever survives Dispel. */
export function effectiveUnyielding(target: TargetState): boolean {
  return target.unyielding() || target.dispellableUnyielding();
}

export function effectiveCarapace(target: TargetState): boolean {
  return target.carapace();
}

/** Tough/Tough Steady stay mutually exclusive even once `dispellableTough` is folded in: an innate
 *  toggle always wins (Tough Steady included - there's no dispellable Tough Steady, see
 *  `TargetState.dispellableTough`'s doc comment). */
export function effectiveToughKind(target: TargetState): ToughKind {
  if (target.toughKind() !== 'off') return target.toughKind();
  return target.dispellableTough() ? 'tough' : 'off';
}

/** Flat ARM bonus from Shield specifically - always the innate capability's bonus (there's no
 *  dispellable Shield). Kept apart from `spellArmBonus` so Chain Weapon can ignore just this
 *  component (see `sequence.ts`'s `SequenceTarget.shieldArmBonus`). Unaffected by Dispel for the
 *  same reason. */
export function shieldArmBonus(target: TargetState): number {
  return target.shieldAmount();
}

/** Flat ARM bonus from both spell categories (Dispellable or not). Kept apart from `shieldArmBonus`
 *  so Blessed can ignore just this component. */
export function spellArmBonus(target: TargetState): number {
  return target.spellArmAmount() + target.upkeepSpellArmAmount();
}

/** Same, but counting only the permanent "Spell" bonus - what's left of `spellArmBonus` once some
 *  attack's Dispel effect has fired (the "Upkeep spell / Animus" bonus is always dispellable by
 *  definition, so it never survives). */
export function spellArmBonusPostDispel(target: TargetState): number {
  return target.spellArmAmount();
}

export function spellDefBonus(target: TargetState): number {
  return target.spellDefAmount() + target.upkeepSpellDefAmount();
}

export function spellDefBonusPostDispel(target: TargetState): number {
  return target.spellDefAmount();
}

export interface TargetSummaryTag {
  /** Stable across a re-render even when `label` itself changes (e.g. adjusting Focus/Fury's
   *  point count, or switching Tough to Tough Steady, changes the text but not the identity of
   *  that one tag) - see `target-panel.html`'s `@for` tracking this instead of the label string
   *  itself, to avoid NG0956: tracking by the text would make Angular treat such a change as
   *  removing one tag and adding an unrelated one (destroying and recreating its DOM node)
   *  instead of just updating the existing node's text. Every tag here is a fixed, known-in-advance
   *  capability, keyed by name. */
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
  if (target.dispellableTough()) tags.push({ key: 'dispellableTough', label: 'Tough [Up]' });
  if (target.shieldAmount() > 0) tags.push({ key: 'shield', label: `Shield +${target.shieldAmount()} ARM` });
  if (target.unyielding()) tags.push({ key: 'unyielding', label: 'Unyielding' });
  if (target.dispellableUnyielding()) tags.push({ key: 'dispellableUnyielding', label: 'Unyielding [Up]' });
  if (target.carapace()) tags.push({ key: 'carapace', label: 'Carapace' });
  if (target.rapidHealing()) tags.push({ key: 'rapidHealing', label: 'Rapid Healing' });
  if (target.spellDefAmount() > 0) tags.push({ key: 'spellDef', label: `Spell +${target.spellDefAmount()} DEF` });
  if (target.spellArmAmount() > 0) tags.push({ key: 'spellArm', label: `Spell +${target.spellArmAmount()} ARM` });
  if (target.upkeepSpellDefAmount() > 0) {
    tags.push({ key: 'upkeepSpellDef', label: `Upkeep +${target.upkeepSpellDefAmount()} DEF` });
  }
  if (target.upkeepSpellArmAmount() > 0) {
    tags.push({ key: 'upkeepSpellArm', label: `Upkeep +${target.upkeepSpellArmAmount()} ARM` });
  }
  return tags;
}
