import { AttackEffects, AttackType, EffectTrigger, RollModifiers } from '../attack-model';

/** Named persistent target debuffs an attack can inflict on a hit or a crit. See doc comments on
 *  each in `docs/`. 'dispel' and 'grievousWounds' are the odd ones out - neither debuffs DEF/ARM
 *  directly ('dispel' strips currently-dispellable spell bonuses/rules, 'grievousWounds' removes
 *  Tough/Tough Steady and Rapid Healing, see `profileFor`/`damageBranches`) - but both are modeled
 *  the same way (a `DebuffState` flag that, once set, persists for the rest of the sequence) since
 *  they're exactly as "sticky" as the others. */
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
  | 'dispel'
  | 'grievousWounds';

export interface StatEffect {
  type: StatEffectType;
  trigger: EffectTrigger;
  /** Only meaningful for 'armPenalty' (generic "-X ARM"): how much ARM to remove. */
  amount?: number;
}

export type RofValue = '-' | 'd3' | '2d3';

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
  /** How many times this weapon fires, guaranteed (1-10, set by the player) - independent of
   *  `rof`'s additional random shots on top. Applies to every attack type, unlike `rof`
   *  (ranged-only). Unset defaults to 1, matching every attack's behavior before this field
   *  existed. */
  attackCount?: number;
  /** Ranged-only: on top of `attackCount`'s guaranteed shots, fires this many EXTRA independent
   *  shots against the target, decided ONCE via a die roll before any of this attack's dice are
   *  thrown (see the module doc comment's "Rate of Fire" section) - total shots fired = `attackCount`
   *  + this roll's result. Ignored for melee/arcane attacks. Unset/'-' means no extra shots. */
  rof?: RofValue;
  /** Ranged-only: caps how many additional shots with THIS weapon the attacker can buy using
   *  Attacker Focus, on top of `attackCount`/`rof` - 0 (or unset) means this weapon isn't buyable
   *  at all (today's default, matching melee-only buying before this existed). `Infinity` means
   *  unlimited, exactly like a melee weapon's own unrestricted buying. A finite value (1 or 2) is
   *  tracked as a separate per-weapon "uses remaining" cap layered on top of the SAME shared Focus
   *  spend a melee buy already costs - see `SequenceContext.reloadIndexOf`'s own doc comment in
   *  single-target.ts for exactly how that's folded into the existing `attackerFocusLeft` vector.
   *  Ignored entirely for melee/arcane rows. */
  reload?: number;
  /** Effects scoped to this attack alone (Brutal Damage, Armor Piercing, Decapitation, Trash, Shatter). */
  effects?: AttackEffects;
  /** Effects that persist on the target for the rest of the sequence once triggered. */
  statEffects?: StatEffect[];
  /** Manual override: this attack automatically hits regardless of DEF (e.g. target is Stationary). */
  forceAutoHit?: boolean;
  /** This attack ignores every Stat-type bonus flagged Spell (DEF and ARM alike) on the target -
   *  a non-spell Stat-type bonus (a feat, a non-spell aura) is never Blessed-ignorable. */
  blessed?: boolean;
  /** This attack ignores the target's Shield ARM bonus specifically (nothing else). */
  chainWeapon?: boolean;
  /** On a critical hit, this attack fires again immediately with the same profile, against
   *  whatever state resulted from the crit - and that instance can itself crit and fire again,
   *  recursively (bounded by `MAX_SHRED_DEPTH`) - see the module doc comment. */
  criticalShred?: boolean;
  /** Once a shot from THIS weapon's own volley (its `attackCount`/`rof` shots) has hit (`'hit'`) or
   *  specifically crit (`'crit'`), every LATER shot of that same volley automatically hits - never
   *  carries into a different weapon row. See the module doc comment's "Sustained Attack" section. */
  sustainedAttack?: EffectTrigger;
  /** Stable per-computation key grouping every attack owned by the SAME attacker, for Puppet
   *  Master's shared reroll token (see `resolvePmSplit`) - deliberately NOT `attackerName`, which
   *  is a display string two different (both-unnamed) attackers can collide on. Every attack
   *  belonging to one attacker must carry the same index; unused when `hasPuppetMaster` is unset. */
  attackerIndex?: number;
  /** True on every attack belonging to an attacker with Puppet Master active - see the module doc
   *  comment's Puppet Master section and `resolvePmSplit`. */
  hasPuppetMaster?: boolean;
  /** Focus points (0-10) this attack's own attacker can spend - uniform across every attack
   *  belonging to the same attacker, same convention as `hasPuppetMaster`. Unset/0 means this
   *  attacker has no Focus and every Focus code path is a no-op for it. See the Attacker Focus
   *  section in single-target.ts. */
  attackerFocus?: number;
  /** This attack's own to-hit roll is boosted (+1 die) for free, unconditionally, on EVERY shot of
   *  this row - already baked into `modifiers.boostDice` by `toSequencedAttack` (the weapon's own
   *  "Boosted" toggle only; see `chargeAttackBoost` below for Cavalry Charge's own, narrower,
   *  first-shot-only version of this). This flag's only remaining job is telling Attacker Focus's
   *  boost-attack-roll decision (`chooseAttackerAttackBoost`) that this roll is already boosted and
   *  ineligible for a further Focus-funded boost (a roll can only be boosted once). */
  boostedAttack?: boolean;
  /** Same idea for the damage roll and `resolveAttackerDamageBoostChoice` - already baked into
   *  `damageModifiers.boostDice` (the "Boosted" toggle only - see `chargeDamageBoost` below). */
  boostedDamage?: boolean;
  /** This row is eligible for Cavalry Charge's free attack-roll boost - but, unlike `boostedAttack`
   *  above, only on the row's own genuine first configured shot, never on a later shot from
   *  `attackCount > 1`, a Focus-bought extra attack with this weapon, or (a documented scope cut)
   *  a Critical-Shred bonus attack chained off that first shot. NOT baked into `modifiers` by
   *  `toSequencedAttack` - `single-target.ts`'s `withChargeBoost` applies the actual +1 die
   *  dynamically, only where the row's first shot is genuinely resolved. */
  chargeAttackBoost?: boolean;
  /** Same idea for the damage roll - true for both `charge` and `cavalryCharge` (Charge alone only
   *  ever boosts the damage roll, not the attack roll - see `withChargeBoost`). */
  chargeDamageBoost?: boolean;
  /** Which targets (by index into `computeMultiTargetSequenceOdds`'s own `targets` array) this
   *  weapon is in range of - unset means every target (the default - see the module doc comment's
   *  "Multiple targets" section). Index-based for the same reason `attackerIndex` is: a display
   *  name isn't a safe, collision-free key. */
  eligibleTargetIndices?: number[];
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
  /** Offensive Knowledge of the Damned: a 0-10 pool of forced rerolls shared across EVERY attacker
   *  (not per-attacker like Puppet Master), spent via the same kind of fixed, no-lookahead rule
   *  Puppet Master uses - see `resolveKotdOffSplit` and the module doc comment's Knowledge of the
   *  Damned section. */
  offensiveKnowledgeOfTheDamned?: number;
  /** Defensive Knowledge of the Damned: a 0-10 pool of forced rerolls the TARGET can spend against
   *  any attacker's attack or damage roll, chosen optimally with full sequence lookahead (like
   *  Focus/Fury) - see `resolveKotdDefChoice`. */
  defensiveKnowledgeOfTheDamned?: number;
  /** Shield Guards: a 0-10 pool of one-time blocks, each fully negating one RANGED attack roll
   *  (damage AND any statEffects it would have inflicted) - a TRUE block: unlike Fury, it does NOT
   *  trigger Rapid Healing (the attack never "landed"), and unlike a Critical-Shred-chaining crit
   *  it negates, a blocked crit does NOT chain (though it still counts toward Hit%/Crit%). Spent
   *  optimally, once per roll, same lookahead as Focus/Fury - see `bestAction`. Ranged attacks
   *  only; Scapegoats cover melee. */
  shieldGuards?: number;
  /** Scapegoats: the melee-only mirror of `shieldGuards` - a 0-4 pool (a smaller cap than every
   *  other resource here, see MAX_SCAPEGOATS), same true-block semantics. */
  scapegoats?: number;
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
  /** Flat ARM bonus from every currently-active Stat-type bonus that's NOT spell-flagged (a feat,
   *  a non-spell aura) - the counterpart to `spellArmBonus` that Blessed never ignores (only
   *  Dispel does, via this pre/post pair). Still folded into the same final `arm` Armor Piercing
   *  halves against in `attack-model.ts`'s `resolveArm`, so it needs no AP-specific handling. */
  nonSpellArmBonus?: number;
  /** Same, but counting only the non-spell bonuses that are NOT flagged Dispellable. */
  nonSpellArmBonusPostDispel?: number;
  /** Flat DEF bonus counterpart to `nonSpellArmBonus`. */
  nonSpellDefBonus?: number;
  /** Same, but counting only the non-spell DEF bonuses that are NOT flagged Dispellable. */
  nonSpellDefBonusPostDispel?: number;
  /** +2 ARM against melee attacks specifically (innate or spell-granted). */
  unyielding?: boolean;
  /** `unyielding` as it'd read post-Dispel - see `toughPostDispel`. */
  unyieldingPostDispel?: boolean;
  /** +4 ARM against ranged attacks specifically (innate or spell-granted). */
  carapace?: boolean;
  /** `carapace` as it'd read post-Dispel - see `toughPostDispel`. */
  carapacePostDispel?: boolean;
  /** The target heals d3 boxes after any hit that deals nonzero damage without destroying it -
   *  see `healBranches`. Turned off for the rest of the sequence by Grievous Wounds (there's no
   *  Dispel-style pre/post pair here: unlike Tough/Unyielding/etc. this isn't currently reachable
   *  as a spell grant from the UI, and Grievous Wounds is a one-way switch, not a removable buff). */
  rapidHealing?: boolean;
}

/** One shot within a weapon's own volley (its `attackCount`/`rof` shots - see the module doc
 *  comment's "Rate of Fire" section). `hitChance`/`critChance`/`averageDamage` are all conditional
 *  on THIS SHOT actually firing (see `occursChance`) - "if this shot happens, here's what to
 *  expect from it" - matching how `SequenceStepResult`'s own fields are conditional on the target
 *  still being alive when the WEAPON's turn comes up. A Critical Shred chain triggered by this
 *  shot's own crit is folded into `averageDamage` (every depth contributes), but never creates a
 *  separate `SequenceShotResult` entry - it's additional depth within resolving this ONE shot, not
 *  another shot. */
export interface SequenceShotResult {
  /** Chance this shot actually fires, conditional on the target still being alive when the
   *  weapon's turn comes up - exactly 1 unless this shot is past the weapon's guaranteed `#
   *  Atks` base (so it only fires if ROF's roll reaches this far), a `# Atks = 0` pure-ROF
   *  weapon's very first shot, or an earlier shot in this SAME volley destroyed the target first. */
  occursChance: number;
  hitChance: number;
  critChance: number;
  averageDamage: number;
}

export interface SequenceStepResult {
  attack: SequencedAttack;
  /** One entry per possible shot index in this weapon's own volley (1..the highest possible
   *  `attackCount`/`rof` total) - see `SequenceShotResult`'s doc comment. */
  shots: SequenceShotResult[];
  /** Chance the target is newly destroyed on exactly this attack (unconditional, out of the original 1.0). */
  destroyChanceAtThisStep: number;
  /** Chance the target has been destroyed by this attack or any earlier one. */
  cumulativeDestroyChance: number;
  /** Unconditional expectation of remaining boxes after this attack (destroyed counts as 0). */
  expectedBoxesRemaining: number;
  /** Chance the target is newly destroyed on this attack, bucketed by how many of THIS weapon's
   *  own shots were still owed (never fired) at the moment it died - index `s` holds the chance it
   *  died leaving exactly `s` shots of this row unresolved. Unlike `shots[]` (indexed by absolute
   *  shot position, which K-branch-dependently corresponds to different "shots remaining" values),
   *  this index is K-INVARIANT: it's exactly the coordinate `computeMultiTargetSequenceOdds` needs
   *  to hand this row's unfired shots to the next target - see the module doc comment's "Multiple
   *  targets" section. Sums to `destroyChanceAtThisStep`. Length equals this row's own maximum
   *  possible shot count. */
  destroyChanceByShotsRemaining: number[];
  /** Same total mass as `destroyChanceByShotsRemaining`, further broken down by each focus-enabled
   *  attacker's own remaining Attacker Focus at the moment of death - `computeMultiTargetSequenceOdds`
   *  needs this extra coordinate to correctly hand Focus forward to the next target, since Focus is
   *  one shared pool for the whole multi-target sequence, not reset per target (see single-target.ts's
   *  Attacker Focus section). Always covers the FULL mass (every entry here sums to
   *  `destroyChanceByShotsRemaining`'s own total) - `attackerFocusRemaining` is simply `[]` on every
   *  entry when no attacker has Focus active (the common case), never an empty array of entries. */
  destroyMassByShotsRemainingAndFocus: { shotsRemaining: number; attackerFocusRemaining: number[]; probability: number }[];
}

export interface SequenceResult {
  steps: SequenceStepResult[];
  finalDestroyChance: number;
  /** Remaining-boxes distribution conditional on the target surviving the whole sequence. */
  survivalDistribution: { boxes: number; probability: number }[];
  /** True-optimal Attacker Focus policy's own actual decisions, recorded during the forward replay
   *  and aggregated per attacker/situation - the raw data `summarizeFocusStrategy` (single-target.ts)
   *  turns into player-facing advice text. Empty whenever no attacker has Focus active. */
  focusStrategy: FocusStrategyEntry[];
  /** Destroy mass arising from Attacker Focus buying MORE attacks after every configured row had
   *  already resolved - i.e. mass that arrived via a multi-target `RowInjection` at
   *  `row: attacks.length` (an attacker who'd already exhausted every configured row against an
   *  EARLIER target, but still had Focus left over - see single-target.ts's Attacker Focus section
   *  and `computeMultiTargetSequenceOdds`'s own handling of such entries). Not tied to any
   *  particular `SequenceStepResult` - there's no configured row for it to belong to.
   *  `computeMultiTargetSequenceOdds` reads this directly, alongside every step's own
   *  `destroyMassByShotsRemainingAndFocus`, to keep handing leftover Focus forward correctly to a
   *  THIRD target if this one also doesn't consume all of it. Always empty for a plain single-target
   *  call (no `RowInjection` ever lands on `row: n` there). */
  postSequenceBuyingDestroyMass: { attackerFocusRemaining: number[]; probability: number }[];
}

/** One weapon's own recorded Focus-spending tally within one attacker/situation bucket - see
 *  `FocusStrategyEntry`. `weaponLabel` is the display label of the weapon this mass applies to:
 *  for `boostAttackMass`/`boostDamageMass`/their `*Bought` counterparts, the weapon whose OWN roll
 *  is being decided; for `buyMass`, the weapon actually fired as the bought attack - which can be
 *  a DIFFERENT weapon than whichever row's own boundary triggered the buy decision (buying always
 *  happens at the attacker's own LAST configured row, but picks whichever melee weapon scores
 *  best). All mass figures are probability-weighted (summing to at most 1 across the whole
 *  per-attacker log, not per weapon or situation). The `Mass`/`MassBought` split lets the Focus
 *  strategy summary say WHEN a boost applies - on this weapon's own configured attack(s), on an
 *  attack bought with leftover Focus, or both, since the true-optimal policy can genuinely differ
 *  between the two (e.g. boost the attack roll on a guaranteed initial swing, but boost damage
 *  instead once buying extra attacks late in the fight). `buyMass` itself needs no such split - the
 *  decision to buy an attack at all only ever happens once Focus is being spent past the attacker's
 *  own configured attacks, so it's inherently a "bought" concept already. */
export interface FocusWeaponTally {
  weaponLabel: string;
  /** The weapon's own `AttackType` - lets the summary name the weapon's type emoji alongside its
   *  label (see `TYPE_EMOJI` in `attack-model.ts`). */
  weaponType: AttackType;
  boostAttackMass: number;
  boostAttackMassBought: number;
  boostDamageMass: number;
  boostDamageMassBought: number;
  buyMass: number;
}

/** One attacker's own recorded Focus-spending tallies, split by target "situation" (healthy vs
 *  debuffed - see single-target.ts's `situationOf`) and, within each situation, by weapon -
 *  `undefined` for a situation this attacker never actually reached during the forward replay.
 *  `debuffCauses`, when the `debuffed` bucket has any data at all, names which SPECIFIC debuff(s)
 *  actually put the target there for this attacker (`'knockedDown'`/`'stationary'`, either or
 *  both) - lets `summarizeFocusStrategy` label its branch condition with the real debuff instead
 *  of the coarse "Knocked Down or Stationary" umbrella every time. */
export interface FocusStrategyEntry {
  attackerIndex: number;
  healthy?: FocusWeaponTally[];
  debuffed?: FocusWeaponTally[];
  debuffCauses?: readonly ('knockedDown' | 'stationary')[];
}

/** One step of a `summarizeFocusStrategy` walkthrough - either a plain unconditioned line (a step
 *  whose advice doesn't depend on target situation, e.g. it only ever fires while the target is
 *  still healthy) or a branch: a situation condition ("If Knocked Down or Stationary" / "If not
 *  Knocked Down or Stationary") together with the ordered lines of advice specific to that
 *  situation. A branch only appears when the true-optimal policy's advice genuinely differs by
 *  situation for at least one weapon/step - see `summarizeFocusStrategy`'s own doc comment. */
export type FocusStrategyItem =
  | { readonly kind: 'line'; readonly text: string }
  | { readonly kind: 'branch'; readonly condition: string; readonly lines: readonly string[] };

/** Where a target's probability mass enters the fight, instead of the default "100% before row
 *  0" - see the module doc comment's "Multiple targets" section. `shotsRemaining === 0` means
 *  "enter row `row` completely fresh" (it gets its own newly-rolled ROF shot count, exactly like
 *  row 0 does today); `shotsRemaining > 0` means "resume row `row`'s own weapon with exactly this
 *  many of its shots still unfired" (a fixed count - it does NOT get a fresh ROF roll, since the
 *  weapon's total shot count for this volley was already decided before the target it's now
 *  facing ever came under fire). */
export interface RowInjection {
  row: number;
  shotsRemaining: number;
  probability: number;
  /** Attacker Focus remaining per focus-enabled attacker, carried forward from an earlier target in
   *  a multi-target sequence - Focus is one shared pool for the whole sequence, not reset per
   *  target (see single-target.ts's Attacker Focus section). Unset means "start fresh from each
   *  attacker's own configured attackerFocus" - the only behavior a single-target computation, or
   *  target 0 of a multi-target one, ever needs. Also carries each Reload-capped weapon's own
   *  remaining uses, appended as extra slots right after the Focus ones - see
   *  `SequenceContext.reloadIndexOf` in single-target.ts for the exact slot layout. */
  attackerFocusRemaining?: number[];
}

export interface SequenceOptions {
  /** `false` means this row is a no-op for this target (the weapon isn't in range of it): `dist`
   *  passes through unchanged, the row contributes an empty step, and the backward induction
   *  aliases `getValueTableAt[k]` straight to `getValueTableAt[k+1]` rather than building a table.
   *  Defaults to every row active - see the module doc comment's "Multiple targets" section. */
  rowActive?: boolean[];
  /** Defaults to `[{ row: 0, shotsRemaining: 0, probability: 1 }]` - today's exact single-target
   *  behavior (100% of the mass starts fresh before row 0). See `RowInjection`. */
  injection?: RowInjection[];
  /** "Expected destroy chance of every LATER target in a multi-target sequence, given the
   *  attacker enters this target at this exact `(row, shotsRemaining)` position (see
   *  `RowInjection` for what that pair means) with this much leftover Attacker Focus" - lets this
   *  target's own Attacker-Focus decisions weigh preserving Focus for later targets against
   *  spending it here now, instead of only ever optimizing this target's own destroy chance.
   *  `row`/`shotsRemaining` matter, not just the Focus amount: a later target's own real odds
   *  depend heavily on how much of THIS attacker's weaponry is already spent by the time it's
   *  reached (e.g. entering at the very first row with everything still fresh reads nothing like
   *  entering after every configured row is already used up) - collapsing that away and always
   *  assuming a fresh start at row 0 was an earlier, materially wrong approximation. Built by
   *  `computeMultiTargetSequenceOdds`'s own reverse pass over targets; unset (the only behavior a
   *  single-target call, or the LAST target of a multi-target one, ever needs) means every
   *  Attacker-Focus decision stays exactly as locally-optimal as before this existed.
   *  `attackerFocusLeft` here is the same combined vector `RowInjection.attackerFocusRemaining`
   *  carries - Focus slots then Reload slots, see `SequenceContext.reloadIndexOf`. */
  attackerFocusDownstreamValue?: (row: number, shotsRemaining: number, attackerFocusLeft: number[]) => number;
}

/** One target's own result from `computeMultiTargetSequenceOdds`. */
export interface TargetSequenceResult {
  result: SequenceResult;
  /** Total probability mass that ever gets a chance to be resolved against THIS target - 1 for the
   *  first target in the list (always engaged), less than 1 for a later one whenever it depends on
   *  an earlier, shared-eligibility target dying first. NOT simply "the preceding target's own
   *  `finalDestroyChance`": a target with NO weapons ranked ahead of it that share ANY of its own
   *  eligible rows is engaged with certainty regardless of what happens to earlier targets (see the
   *  module doc comment's "Multiple targets" section). */
  engagementChance: number;
}
