# ChanceMachine — Technical documentation

## Overview

ChanceMachine is an Angular PWA (Progressive Web App) that computes, via exact enumeration (no Monte Carlo), the hit/destroy probabilities against a target in Warmachine/Hordes, for a sequence of attacks (several attackers, several attacks each) chained against a single shared target.

- **Stack**: Angular 21 (standalone components, signals), TypeScript, Vitest.
- **No runtime dependency beyond Angular**: the calculation engine (`src/app/engine/`) is pure TypeScript with no Angular dependency, testable in isolation.
- **PWA**: `@angular/service-worker`, installable on mobile (Android/iOS via "Add to Home Screen"), works offline (the calculation engine itself makes no network calls - Feedback and the analytics script are the only things that do, and both are best-effort, never required for the app to function).

## Project structure

```
src/
  app/
    engine/                 # Calculation engine, pure TypeScript, no Angular dependency
      dice-pool.ts           # Exact enumeration of d6 dice rolls
      attack-model.ts        # Model of a single attack (to-hit + damage + Tough)
      sequence.ts            # Chaining several attacks against a shared target
      odds-engine.ts          # @Injectable wrapper exposing the engine to components
      engine.spec.ts          # Engine unit tests (Vitest)
    odds-calculator/         # Main UI component (form + results)
    app.ts / app.html / app.css   # Application shell
  index.html
  main.ts
public/
  manifest.webmanifest, icons/   # PWA assets
ngsw-config.json             # Service worker configuration (asset caching)
angular.json                 # Angular CLI build/serve/test configuration
```

## The calculation engine (`src/app/engine/`)

### General principle: exact enumeration, no simulation

Dice rolls in Warmachine/Hordes involve small d6 pools (2 to ~8 dice with boosts). The outcome space (6^n) therefore stays tiny (6^8 ≈ 1.68 million cases, well under a second of computation). The engine therefore enumerates **every** possible outcome and aggregates their exact probabilities, rather than doing random draws (Monte Carlo). This gives deterministic, instant results, with no flicker in the display.

### `dice-pool.ts` — the base building block

- `rollDicePool({ diceCount, discard?, treatOnesAsSixes?, extraCritDice? })`: enumerates every roll of `diceCount` d6 (plus, if configured, `extraCritDice` extra dice), applies `treatOnesAsSixes` first (Jump the Shark — every 1 becomes a 6 before anything else), then any discard (keep the highest/lowest), then computes the sum and returns the aggregated distribution `{ sum, hasDouble, probability }[]`.
  - `discard?: { highest?: number; lowest?: number }`: the two counts are independent and **can be active at the same time** on the same roll (e.g. `{ highest: 1, lowest: 1 }` on 4 dice keeps the two middle dice). `applyDiscard(dice, highestCount, lowestCount)` sorts the dice then slices `sorted.slice(lowestCount, Math.max(lowestCount, sorted.length - highestCount))` — the `Math.max` avoids a `slice` whose end bound is below its start bound if the sum of the two exceeds the number of available dice (in which case the result is simply an empty list, summing to 0, rather than an error).
  - `treatOnesAsSixes` (Jump the Shark): turns every die showing 1 into a 6 before discard/sum/double detection — implemented at the lowest level (on each individual face) so that discard and double detection already see the transformed faces.
  - `extraCritDice` (Sanguine Fate): `N` extra dice rolled alongside the pool, which count toward `hasDouble` detection (a double with an "extra" die does trigger a critical hit) but are **never** included in `sum` — implemented by iterating over `diceCount + extraCritDice` dice in total, of which only the first `diceCount` feed the discard/sum.
- `hasDouble`: true if at least two rolled dice (before discard, counting Sanguine Fate dice) show the same face — that's the critical (double) trigger in WM/H.
- `rerollPoolOnceIf(outcomes, isBad)`: models a single, optional reroll of outcomes flagged `isBad`, correctly preserving the `(sum, hasDouble)` correlation: each kept outcome keeps its own `hasDouble`, and the rerolled probability mass is redistributed across **the entire** original distribution (including its `hasDouble` values) rather than overwriting `hasDouble` to `false`. This is the fixed version of an earlier bug (see below): the old implementation set `hasDouble: false` on every rerolled roll, which silently killed any chance of a critical hit on an attack with reroll active.
- `rerollPoolOnceIfBelow(outcomes, threshold)`: convenience wrapper around `rerollPoolOnceIf` for the "reroll if the sum is below a threshold" case (a below-average damage roll).
- `probabilityAtLeast`, `probabilityOfDouble`: aggregation utilities.
- Safety guard: throws an error beyond 8 dice total (`diceCount + extraCritDice`), well above anything the game produces.

**Bug fixed: `hasDouble` overwritten by a reroll.** The first implementation of reroll (`rerollPoolOnceIfBelow`) forced `hasDouble: false` on *every* roll after a reroll, including rolls that were kept without being rerolled — a naturally critical roll could therefore lose its critical status simply because reroll was enabled on that attack. Fixed by generalizing to `rerollPoolOnceIf(outcomes, isBad)`, which only touches `hasDouble` via the correct redistribution described above.

### `attack-model.ts` — a single attack

The calculation is split into two steps for performance reasons (see `sequence.ts`):

1. **`buildAttackProfile(attack, damage, target, effects, autoHit)` → `AttackProfile`**
   Builds an attack's full probabilistic profile — independent of the target's remaining box count:
   - `missChance`, `hitNonCritChance`, `hitCritChance`
   - `nonCritDamage` / `critDamage`: `damage → probability` distributions, conditional on a non-critical / critical hit.
   - If `autoHit` is true (a Stationary/Knocked Down target facing a melee attack, or an explicit `forceAutoHit`), no to-hit roll is made: `hitChance = 1`, `critChance = 0` (no to-hit dice rolled, so no double possible).
   - If **Brutal Damage** (`effects.brutalDamageDice`) is active, the critical damage distribution uses a larger dice pool (extra dice) than the non-critical distribution.
   - **Armor Piercing** (`effects.armorPiercing: EffectTrigger`): the ARM used for the damage roll (non-critical and/or critical, depending on `appliesOnNonCritHit`/`appliesOnCritHit`) is replaced by `Math.ceil(target.baseArm / 2) + (target.arm - target.baseArm)` — only the printed base is halved; every buff/debuff/penalty currently in play still applies on top, via `target.arm - target.baseArm` (the net modifier total, since `target.arm` is already the fully-resolved ARM). `baseArm` is the ARM **before** any buff/debuff/penalty (see `sequence.ts`), deliberately distinct from `target.arm` (the effective ARM, everything folded in) precisely so this delta can be recovered.
   - **Decapitation** (`effects.decapitation: EffectTrigger`): the relevant damage distribution is doubled afterward via `doubleDamageValues` (each `(damage, p)` becomes `(damage × 2, p)`).
   - **Trash** / **Shatter** (`effects.trash` / `effects.shatter`, booleans): an extra damage die is added if `target.knockedDown` / `target.stationary` is true **at the time of this attack** — these two flags are plain booleans passed in by `sequence.ts`, which alone is responsible for knowing whether the target is currently in that state.
   - This is the expensive part of the calculation (dice enumeration): it's only done **once per attack** (per distinct DEF/ARM/status context, see `sequence.ts`).

2. **`applyProfile(profile)` → `AppliedOutcome[]`**
   Flattens a profile into a plain list `{ probability, isHit, isCrit, damageDealt }` (cheap, just iterates over the distribution maps' entries).

3. **`computeAttackOdds(input)` → `AttackOdds`**
   High-level function for a single, isolated attack (used by tests and, conceptually, by any component that only needs a single attack): builds the profile, applies it, aggregates into `hitChance`, `missChance`, `critOnHitChance`, `damageDistribution`, `expectedDamage`, `destroyChance` (accounting for Tough), `chanceOfAtLeast(n)`.

**Roll modifiers (`RollModifiers`)**, applied independently to the to-hit roll and/or the damage roll (each has its own `modifiers`/`damageModifiers`):
- `boostDice`: extra dice added to the base pool (2d6).
- `discard`: `{ highest?: number; lowest?: number }` discard before summing — both can be set at once (see `dice-pool.ts` above).
- `reroll`: a single, optional reroll — see `applyRerollIfConfigured` below.
- `treatOnesAsSixes` (Jump the Shark), `extraCritDice` (Sanguine Fate): passed through as-is to `rollDicePool` (see `dice-pool.ts`).

**Reroll (`applyRerollIfConfigured` + `isBadDamageRoll`)**: when `modifiers.reroll` is active, the pool is rerolled via `rerollPoolOnceIf` with a "bad roll" criterion that differs by context:
- To-hit roll: "bad" = `!isHitOutcome(...)` (the roll would genuinely miss — not a simple `sum < neededDiceSum` comparison, see below for why).
- Damage roll: "bad" = `isBadDamageRoll`, i.e. a sum strictly below average (`sum < 3.5 × diceCount`) — rerolling a below-average roll strictly maximizes expected damage, so no configurable threshold is needed on the UI side.

**Supported effects (`AttackEffects`, formerly `CriticalEffects`)** — a deliberately short, precise list rather than a vague, generic system, though it has grown since its first version (which only contained Knockdown and Brutal Damage — Knockdown has since been moved into `sequence.ts`'s generic `StatEffect` system, see below):
```ts
type EffectTrigger = 'hit' | 'crit'; // 'hit' fires on any hit (crits included); 'crit' only on a critical hit

interface AttackEffects {
  brutalDamageDice?: number;      // crit only, no configurable trigger
  armorPiercing?: EffectTrigger;
  decapitation?: EffectTrigger;
  trash?: boolean;
  shatter?: boolean;
}
```
`appliesOnNonCritHit(trigger)` (`=== 'hit'`) and `appliesOnCritHit(trigger)` (`=== 'hit' || === 'crit'`) centralize this triggering logic — an effect with `trigger: 'hit'` therefore also applies on a critical hit (a crit is a special case of a hit), whereas `trigger: 'crit'` only applies on a critical hit.

**Attack type (`AttackType`)**: `'melee' | 'ranged' | 'arcane'`. Currently used to condition auto-hit against a Knocked Down/Stationary target (only melee automatically hits an immobilized target; ranged and magic roll normally against a DEF capped at 5 in that case, see `sequence.ts`).

**Extreme rolls (`isHitOutcome`).** Outside the `autoHit` case, the to-hit roll applies an extra rule before the classic sum-vs-DEF comparison: every **kept** die (after any discard) showing 1 is always a miss, and every one showing 6 is always a hit (unless only one die is kept). Since a die's face is always ≥ 1, the sum of N dice can only equal exactly N if every one shows 1, and can only equal 6N if every one shows 6 — `isHitOutcome` therefore detects both cases purely from `outcome.sum` and the number of kept dice (`keptDiceCount`), with no need to inspect each face individually or surface extra information from `dice-pool.ts`. A hit forced by "all 6s" with 2+ dice is necessarily also a double, and therefore a critical hit (`hasDouble` is true as soon as ≥2 dice show the same face) — no special handling is needed for `hitCritChance` to count it correctly.

### `sequence.ts` — chaining several attacks

`computeSequenceOdds(attacks: SequencedAttack[], target: SequenceTarget) → SequenceResult`

Computes the probability of destroying a target over the course of an attack sequence **ordered by the user** (no automatic ordering optimization — a product decision: see the functional documentation).

**Calculation model — a state distribution, not a combinatorial tree:**

Rather than branching a probability tree per attack (combinatorial explosion), the engine maintains a probability distribution over a **target state**, whose "persistent penalties" part is grouped into `DebuffState`:

```ts
interface DebuffState {
  knockedDown: boolean;
  stationary: boolean;   // Ice Cage at 2+ stacks also makes the target Stationary, see isStationary
  iceCageStacks: number; // the only penalty explicitly stackable besides armPenalty
  shadowbind: boolean;
  blind: boolean;
  paralyzed: boolean;
  flare: boolean;
  weaken: boolean;
  armPenalty: number;    // generic "-X ARM", cumulative
  dispelled: boolean;    // once true, every currently-Dispellable spell bonus/rule is gone - see "Target capabilities" below
  grievouslyWounded: boolean; // once true, no Tough/Tough Steady and no Rapid Healing - see "Rapid Healing" below
}
```

... combined with `boxes` (boxes remaining), `focusLeft`/`furyLeft` (remaining resource points) and `destroyed` (absorbing state) in the rest of the calculation. For each attack in the sequence, its profile is "folded" into the current state distribution:
- For each living state, the effective DEF/ARM are computed (`effectiveDef`/`baseArm - debuffState.armPenalty`) and whether the attack should auto-hit (melee + `isKnockedDownOrStationary`, or an explicit `forceAutoHit`), the right precomputed profile is chosen, and each outcome's probability is distributed across the new states (reduced boxes and/or new penalties, or destroyed) — after applying, if applicable, the target's **optimal** spend of a Focus/Fury point (see below).
- A Tough roll is retried every time damage (after any Focus/Fury mitigation) would be lethal (no "once per turn" limit in this model — a documented simplification in the code) - **unless the target is currently Knocked Down/Stationary**, in which case plain Tough can't be attempted at all (the real tabletop rule) and the target is simply destroyed; **Tough Steady** (`SequenceTarget.toughSteady`) is immune to that negation - see `damageBranches`. **Grievous Wounds** (`DebuffState.grievouslyWounded`) removes both outright, on top of (and regardless of) that negation - it's the one condition Tough Steady isn't immune to.
- If Tough (or Tough Steady) succeeds, the target is simplified to 1 box remaining and Knocked Down (standard Tough rule behavior), with no fine-grained re-modeling of a partial damage grid — this rule is what couples the "persistent penalties" sub-problem to the "boxes/resources" sub-problem (see below).

**Persistent effects (`StatEffect` / `StatEffectType`)**: each attack carries an optional `statEffects: StatEffect[]` list, each `{ type, trigger, amount? }` (`amount` only for `'armPenalty'`). `applyStatEffectsForOutcome(state, statEffects, isCrit)` applies, for a given outcome (hit or critical hit), every effect whose trigger matches (`'hit'` fires on any hit including a critical one; `'crit'` only on a critical hit) via `applyStatEffect`:
- Every boolean flag (`knockedDown`, `stationary`, `shadowbind`, `blind`, `paralyzed`, `flare`, `weaken`, `dispelled`, `grievouslyWounded`) is **idempotent** — re-triggering it has no further effect, in line with the "an effect only applies once unless stated otherwise" rule. `dispelled`/`grievouslyWounded` are the odd ones out semantically (they strip bonuses/capabilities rather than adding a penalty) but mechanically they're just two more sticky flags, same `applyStatEffect` switch cases as the others.
- `iceCageStacks` is incremented on every trigger (the only flag explicitly stackable among the booleans), `armPenalty` is added to on every trigger (as specified for the generic "-X ARM").
- `isStationary(s)` = `s.stationary || s.iceCageStacks >= 2`; `isKnockedDownOrStationary(s)` = `s.knockedDown || isStationary(s)` — it's this last function that determines auto-hit in melee and the DEF cap of 5, exactly the same logic for Knockdown and Stationary (they're only distinguished because Trash/Shatter need to be able to tell them apart).
- `effectiveDef(baseDef, s)`: first caps DEF at `DEF_FLOOR = 5` if `s.paralyzed || isKnockedDownOrStationary(s)`, then subtracts the cumulative flat penalty (`iceCageStacks × 2 + shadowbind×3 + blind×4 + flare×2 + weaken×2`) — reproduces the "additive, with Paralysis/Knockdown/Stationary as a floor" rule validated with the user.

**Avoiding the combinatorial explosion of a dense 11-dimension penalty table (`computeReachableDebuffStates` + `Map<string, ValueTable>`):**

Naively adding `DebuffState`'s 11 dimensions (9 penalty fields plus `dispelled`/`grievouslyWounded`) to the old dense value table `number[boxes][focus][fury]` (already used for Focus/Fury, see below) would have turned it into a ~14-dimension table, whose size would explode combinatorially even for a handful of configured effects. The key to the solution: **`DebuffState` transitions depend neither on the remaining boxes nor on the remaining Focus/Fury points** (the only exception being the Tough → Knockdown coupling, see below), so the set of penalty states *actually reachable* at each step can be precomputed **separately**, once, before the main calculation:

- `computeReachableDebuffStates(attacks, startsKnockedDown, hasAnyTough)` does a light "forward" pass: for each attack, starting from the set of states reachable at the previous step, it computes the states reachable after a non-critical hit, a critical hit, or a miss — and adds, if `hasAnyTough` (`tough || toughSteady`) is true, the "Knocked Down" variant of every candidate state (Tough/Knockdown coupling, see below). The result is deliberately an **over-approximation**: it doesn't matter if a listed state turns out to have zero probability once thresholds/auto-hit are accounted for, as long as no state that's actually reachable is ever missed.
- The main calculation (backward pass + forward pass, see below) then only builds a `(boxes × focus × fury)` value table (`ValueTable`, now 3D instead of 4D) **for each penalty state actually returned by `computeReachableDebuffStates`**, indexed by a compact key (`debuffKey(state)`) in a `Map<string, ValueTable>` — one per step `k` of the sequence (`valueTables: Map<string, ValueTable>[]`). The cost therefore stays proportional to what's *actually reachable* for this specific sequence (in practice a handful of states, bounded by the number of persistent effects actually configured), never to the combinatorial product of the 9 possible dimensions.
- **Tough ↔ Knockdown coupling.** The rest of the penalty transitions are independent of the boxes/Focus/Fury sub-problem, with one exception: the rule "surviving a Tough roll also knocks the target down" makes a `DebuffState` change depend on a dice roll that belongs to the resource sub-problem. `computeReachableDebuffStates` accounts for this by systematically adding the Knocked Down variant of every candidate state whenever `hasAnyTough` is true (whether that roll succeeds or not doesn't matter for this over-approximation pass); `damageBranches` (see below) then computes, at the right moment, which branch (Tough-survival vs. other) actually gets which `DebuffState`.
- **Attack profile cache (`profileCache` / `profileFor`)**: since an attack's effective DEF/ARM/status now depend on the current `DebuffState` (which can vary within a single step `k` if several penalty states are reachable at that point), the profile is no longer cached solely by attack index `k` but by the full key `` `${k}|${usesAutoHit}|${def}|${arm}|${knockedDown}|${isStationary(debuffState)}` `` — the number of distinct contexts actually encountered stays low in practice (bounded by the effects configured on the sequence), so the dice enumeration (the expensive part) is never redone for a context already seen. `def`/`arm` here are already the FULLY resolved numbers (printed stat, persistent debuffs, and the target's static buffs all folded in - see "Target capabilities" below), so the cache key correctly distinguishes contexts that only differ by, say, Unyielding applying to a melee attack but not a ranged one.

**Target capabilities - static, sequence-wide buffs on top of the printed stats, some spell-granted and therefore removable by Dispel:**

Unlike `DebuffState` (attack-triggered, evolves as the sequence plays out), the target's capability fields on `SequenceTarget` are fixed **inputs** for the whole sequence - they model target capabilities (Shield, spell bonuses, Unyielding, Carapace, Tough/Tough Steady) set once before the calculation runs, not something an attack can inflict. What CAN vary mid-sequence is which of these are still *active*, since Dispel (a `StatEffectType`, see above) strips every currently-Dispellable one - so most of these fields come in a **pre-Dispel/post-Dispel pair**, and `profileFor`/`damageBranches` pick whichever half matches `debuffState.dispelled`:

| Capability | Pre-Dispel field | Post-Dispel field |
|---|---|---|
| Shield's ARM bonus | `shieldArmBonus` | *(none - see below)* |
| Spell ARM bonus | `spellArmBonus` | `spellArmBonusPostDispel` |
| Spell DEF bonus | `defBonus` | `defBonusPostDispel` |
| Unyielding | `unyielding` | `unyieldingPostDispel` |
| Carapace | `carapace` | `carapacePostDispel` |
| Tough | `tough` | `toughPostDispel` |
| Tough Steady | `toughSteady` | `toughSteadyPostDispel` |

The UI layer (`odds-calculator.ts`) fills the pre-Dispel half with the "effective" value (innate toggle OR spell grant - `effectiveUnyielding`/`effectiveCarapace`/`effectiveToughKind`/`spellArmBonus`/`spellDefBonus` in `target-panel.model.ts`) and the post-Dispel half with the **raw innate signal alone** (`target.unyielding()`, `target.toughKind() === 'tough'`, etc.). This is a deliberate simplification that falls out of a real invariant in the spell-bonus model: every `'rule'`-kind spell bonus is *forced* Dispellable (see `SpellBonusRow`'s doc comment and `TargetProfileDialog.setSpellKind`), so a spell-granted Unyielding/Tough/Tough Steady is *always* dispellable - meaning "post-Dispel" for these four never needs to filter anything, it's simply "ignore every spell grant, keep only the innate toggle." Only Stat-type spell bonuses (`spellArmBonus`/`defBonus`) have a genuinely per-entry Dispellable flag, so those two are the only fields whose post-Dispel half needs real filtering (`spellArmBonusPostDispel`/`defBonusPostDispel` in `target-panel.model.ts` sum only the spells where `!dispellable()`).

**Shield has no post-Dispel field at all**, and `shieldArmBonus` is read by `profileFor` unconditionally (never gated by `debuffState.dispelled`) - because a spell-granted Shield isn't reachable from the current UI (`SPELL_RULE_OPTIONS` only offers `'tough'`/`'unyielding'`, see the functional documentation), `shieldArmBonus` is always just the innate capability's bonus (`target.shield() ? target.shieldAmount() : 0`), which Dispel can never touch. If the UI ever exposes spell-granted Shield again, this field would need to split into an innate/dispellable pair exactly like the others.

**Two per-attack toggles narrow this further, independent of Dispel**: `SequencedAttack.blessed` makes a specific attack ignore Stat-type spell bonuses (DEF and ARM) entirely, and `SequencedAttack.chainWeapon` makes it ignore Shield's ARM bonus specifically - neither is a `DebuffState` flag (they don't persist or get triggered), just a plain boolean read straight off the attack being resolved. `profileFor` combines both axes:
```ts
const activeSpellArm = atk.blessed ? 0 : debuffState.dispelled ? spellArmBonusPostDispel : spellArmBonus;
const activeShieldArm = atk.chainWeapon ? 0 : shieldArmBonus;
```
- `def = effectiveDef(baseDef, debuffState) + activeSpellDef` - the (Blessed/Dispel-filtered) spell DEF bonus is added *after* the debuff floor/penalty logic, so it still helps even on a floored (Knocked Down/Paralysis) DEF.
- `arm = baseArm - debuffState.armPenalty + activeShieldArm + activeSpellArm + conditionalArmBonus`, where `conditionalArmBonus` is resolved fresh for every attack (`activeUnyielding && atk.type === 'melee' ? 2 : 0` `+` `activeCarapace && atk.type === 'ranged' ? 4 : 0`) since it depends on that specific attack's type - Unyielding/Carapace can't be pre-summed the way Shield/spell bonuses can. `activeUnyielding`/`activeCarapace` are the Dispel-gated pair lookup (`debuffState.dispelled ? unyieldingPostDispel : unyielding`), same pattern as the ARM/DEF bonuses above.
- Critically, **`baseArm`/`baseDef` themselves are never touched by any of this** - they stay the target's raw printed stats. Armor Piercing needs that untouched value to know exactly what to halve (`Math.ceil(baseArm / 2)`), then re-applies every buff/debuff/penalty on top via `arm - baseArm` (see `attack-model.ts`'s `buildAttackProfile`) - it changes *what gets halved*, not whether modifiers apply at all. This is why every one of these bonuses is resolved as a separate addition in `profileFor` rather than folded into `target.arm` before it ever reaches the engine: `attack-model.ts` needs both the fully-resolved `arm` and the untouched `baseArm` side by side to compute that delta.

**Tough/Tough Steady are resolved OUTSIDE `profileFor` entirely** (in the resource-branching logic - `damageBranches`/`bestAction`, see below), so they need the same pre/post-Dispel selection done there instead. Rather than threading five separate parameters (two tough flags × two Dispel variants, plus the shared fail chance) through every call, they're bundled into one `ToughRules` object built once in `computeSequenceOdds` and passed down:
```ts
interface ToughRules {
  hasTough: boolean;
  hasToughSteady: boolean;
  hasToughPostDispel: boolean;
  hasToughSteadyPostDispel: boolean;
  failChance: number; // same threshold either way - Dispel doesn't change the Tough roll's target number, only whether it applies at all
}
```
`damageBranches` picks `debuffState.dispelled ? tough.hasToughPostDispel : tough.hasTough` (and the Tough Steady equivalent), then ANDs in `!debuffState.grievouslyWounded`, before applying the existing Knocked Down/Stationary negation rule - Dispel, Grievous Wounds, and the Knockdown-negation rule are three independent conditions that all have to allow a Tough attempt for it to actually happen (Grievous Wounds is the only one of the three that also blocks Tough Steady - see the module doc comment). `hasAnyTough` (used by `computeReachableDebuffStates`'s over-approximation, and by whether the fail chance is computed at all) stays `hasTough || hasToughSteady` without needing the post-Dispel variants folded in: by construction, `hasToughPostDispel`/`hasToughSteadyPostDispel` can only be true if the corresponding pre-Dispel flag is already true (post-Dispel is strictly the innate-only subset of pre-Dispel, per the invariant above), so they never add a state pre-Dispel wouldn't already cover. Grievous Wounds doesn't need to widen `hasAnyTough` either, for the same reason: it can only ever narrow which states can attempt Tough, never add a new one.

**Rapid Healing - a third sub-problem, folded into `damageBranches`'s output rather than tracked as its own dimension:**

`SequenceTarget.rapidHealing` (a plain boolean, unlike Tough/Unyielding/etc. it has no pre/post-Dispel pair - see its doc comment for why) and `HealingRules` (`{ hasRapidHealing, initialBoxes }`, the `boxes`-dimension counterpart to `ToughRules`, built once in `computeSequenceOdds`) drive `healBranches`:
```ts
function healBranches(boxes, rawDamageDealt, debuffState, focusLeft, furyLeft, healing): ResourceBranch[] {
  if (!healing.hasRapidHealing || rawDamageDealt <= 0 || debuffState.grievouslyWounded) {
    return [{ probability: 1, boxes, debuffState, focusLeft, furyLeft, destroyed: false }];
  }
  return [1, 2, 3].map((healAmount) => ({
    probability: 1 / 3,
    boxes: Math.min(healing.initialBoxes, boxes + healAmount),
    debuffState, focusLeft, furyLeft, destroyed: false,
  }));
}
```
`damageBranches` calls this at both of its exit points - the plain non-lethal case, and the Tough-survival case (from 1 box) - so a target that gets knocked down to 1 box by a lethal hit but saves it via Tough can still heal back up afterward if it's also eligible. `Math.min(healing.initialBoxes, ...)` caps the result at the target's starting box count, which isn't just thematic - it's also *necessary*, since `ValueTable` is indexed `0..initialBoxes` and a heal that overshot that range would be an out-of-bounds write.

**`rawDamageDealt` vs `damageDealt` - the eligibility check is deliberately based on the attack's damage BEFORE Focus/Fury, not the amount that actually reached `boxes`.** A model that spends a resource point to blunt or fully negate a hit was still hit - the point softens the consequence, it doesn't undo the fact that the attack landed - so Rapid Healing still triggers off the original wound. Only a genuine miss, or a hit ARM already reduces to 0 before Focus/Fury is even a factor, skips healing. This means `damageBranches` and `bestAction` have to carry two damage values side by side rather than one:
```ts
function damageBranches(boxes, damageDealt, rawDamageDealt, debuffState, focusLeft, furyLeft, tough, healing): ResourceBranch[]
```
`damageDealt` is whatever a given candidate action actually subtracts from `boxes` (the lethal check, and the non-Tough non-lethal case, both use this one); `rawDamageDealt` only ever reaches `healBranches`, unchanged by whichever mitigation was chosen. `bestAction` receives a single `damageDealt` parameter (the attack's true raw damage, straight from `outcome.damageDealt`) and passes it through as `rawDamageDealt` to all three of its candidate `damageBranches` calls - the no-mitigation one (where it's also the literal `damageDealt`), the Focus one (`max(0, damageDealt - 5)` as `damageDealt`, but still the original as `rawDamageDealt`), and the Fury one (`0` as `damageDealt`, still the original as `rawDamageDealt`). A worked example lives in `engine.spec.ts`'s "Rapid Healing still triggers on a Fury-negated hit" test: a target forced (by an otherwise-certain-destruction lethal hit) to spend its one Fury point still heals afterward, because that hit's raw damage was nonzero even though the mitigated damage that hit `boxes` was 0.

No new `computeReachableDebuffStates` dimension is needed for any of this: healing only ever changes `boxes` (a dimension the value-table machinery already handles per-step), never `DebuffState` - Grievous Wounds is the one thing that gates it, and that's already a `DebuffState` flag tracked for the Tough interaction above.

**Same-attack ordering, established already by Knockdown/Tough and reused here as-is.** Both `bestAction` call sites compute `newDebuffState = applyStatEffectsForOutcome(oldState, atk.statEffects, isCrit)` *before* calling `damageBranches`/`healBranches` - so if a single attack inflicts Grievous Wounds `'on hit'` and also deals the damage that would otherwise trigger Rapid Healing (or a Tough save), the wound is already in effect for that same hit's resolution, not just for later attacks. This isn't special-cased for Grievous Wounds/Rapid Healing - it falls directly out of the existing evaluation order, the same one a Knockdown-and-lethal-damage-in-one-attack scenario already relies on. (A test exercising exactly this - `engine.spec.ts`'s "Grievous Wounds also disables Rapid Healing, including on the very hit that inflicts it" - has to be careful the attack's own damage doesn't also trigger a *self-referential* Tough check the same way; see the Tough-vs-Knockdown tests earlier in the same file for the `boxes: 50` workaround that isolates one attack's effect from corrupting another's.)

**Why it's fast even at ~10 attacks:**

An attack's profile (`buildAttackProfile`, the part that enumerates dice — expensive) does **not** depend on the target's remaining box count. It's therefore cached per distinct context (see `profileCache` above, in practice a small handful per sequence), then reapplied cheaply against every state encountered. A performance test (`engine.spec.ts`) verifies that a sequence of 10 attacks (with or without resource points, with or without persistent effects) runs in under 2 seconds (in practice near-instant).

**Optimal Focus/Fury spending — backward induction (`valueTables`):**

The target may spend, once per attack and after the damage roll, a Focus point (reduces damage by 5) or a Fury point (fully negates damage), never both at once. It's assumed to play **optimally**, meaning: maximizing its probability of surviving the **rest of the sequence**, not just reacting to the current hit. Since the decision is made before knowing future dice rolls, but with a known attack sequence ahead of time, this problem is solved via **backward induction** (dynamic programming) rather than pure forward simulation:

1. **Backward pass**: for each attack `k` (from the last to the first) and for **each penalty state reachable at that step** (`debuffStatesPerStep[k]`, see above), a table `valueTables[k].get(debuffKey(state))[boxes][focusLeft][furyLeft]` is built = probability of surviving attacks `k..n-1` while playing optimally **given that we're in this penalty state**, computed from `valueTables[k+1]` (already known) and attack `k`'s profile for that context. The base case `valueTables[n]` is 1 everywhere, for every penalty state reachable at the end of the sequence (no attacks left = already survived).
2. For each state and each outcome of attack `k`, `bestAction` (in `sequence.ts`) compares the 3 possible choices (spend nothing / spend Focus / spend Fury) and keeps the one that maximizes this future survival value.
3. **Forward pass**: the exact same policy is replayed (via the same already-computed `valueTables`) to produce the actual state distribution and the displayed statistics (`hitChance`, `destroyChanceAtThisStep`, etc.).

**Tie-breaking.** Comparing only "probability of surviving the rest of the sequence" can produce strict ties (e.g. the target is doomed either way, or no future attack depends on the exact remaining box count anymore). A naive comparison (strict `>`) would then systematically resolve these ties toward "spend nothing", which reads as counter-intuitive behavior (the target refuses to defend itself on the current hit even though doing so would cost it nothing). `bestAction` therefore uses a **3-level lexicographic score** (see `outcomeScore`/`isBetterScore`): (1) probability of surviving the rest of the sequence — the real objective; (2) as a tiebreaker, probability of surviving **this specific hit**; (3) as a further tiebreaker, number of boxes preserved. Only when all 3 levels are fully tied does the point go unspent (default behavior: keep the resource).

**Critical Shred (`SequencedAttack.criticalShred`) — a bounded self-referential value problem, wrapping `bestAction` rather than replacing it:**

Every other effect changes DEF/ARM/boxes/`DebuffState` for a FIXED, known-in-advance sequence of attacks. Shred is the odd one out: a crit makes the SAME attack fire again immediately, and that instance can itself crit and fire again - so the number of dice rolls "at position `k`" becomes a random variable, not a constant. Rather than dynamically growing the sequence (which would make `attacks.length` itself probabilistic, breaking the `valueTables[k]`/`debuffStatesPerStep[k]` indexing everywhere else), this is modeled as a small recursive value problem local to position `k`, bounded by a constant `MAX_SHRED_DEPTH = 10`:

```ts
function attackChainValue(k, atk, debuffState, boxes, focusLeft, furyLeft, depthRemaining, outerValueAt, cache): number
```

Resolves ONE instance of attack `k`, and - on a crit with `atk.criticalShred` set and `depthRemaining > 0` - recurses into ANOTHER call to itself (`depthRemaining - 1`) instead of falling through to `outerValueAt` (attacks `k+1` onward); every other outcome (miss, non-crit hit, or a non-shredding attack) takes the `outerValueAt` branch as before. This means `attackChainValue` **replaces** the old inline `bestAction`+`branchesValue` call at every use site in the backward pass, shred or not - for an attack without Critical Shred, `continuesChain` is always false, so it degenerates to exactly the pre-Shred single-instance computation (verified by the full pre-existing test suite passing unchanged after the refactor). Memoized per `` `${depthRemaining}|${debuffKey}|${boxes}|${focusLeft}|${furyLeft}` `` in a `cache` shared across the whole `buildValueTable` grid for a given `k` - the same `(boxes, damage-so-far)` combination is reachable via many different orderings of chained crit damage, and this cache is what keeps that from being recomputed each time.

**Truncation, not a rules limit.** There's no tabletop cap on how many times a Shred chain can continue - only the dice decide. `MAX_SHRED_DEPTH = 10` caps the calculation anyway: each further instance requires another crit, so the untruncated tail's probability is `critChance^depth` - for any realistic crit chance this is astronomically small well before depth 10 (`0.3^10 ≈ 6e-6`), the same "exact enough" tradeoff already used for Tough's "no once-per-turn limit" and the app's existing 0.0005 display cutoff. `engine.spec.ts`'s "extends average damage into a geometric series" test measures this directly: an untruncated infinite series would give exactly `245/31`, and the actual (depth-10-truncated) result differs from that by ~3e-9 - small enough that the test needs `toBeCloseTo(..., 8)` rather than the `9` used everywhere else in that file, specifically to keep this real (if minuscule) truncation gap from failing on floating-point-level precision.

**`computeReachableDebuffStates` widened to match.** A shredding attack's crit-only `statEffects` (Ice Cage, generic "-X ARM" - anything explicitly stackable) can fire once per instance in the chain, not just once per outer attack. The over-approximation pass therefore explores up to `MAX_SHRED_DEPTH + 1` repeated crit-effect applications for a shredding attack instead of just one (see the loop in `computeReachableDebuffStates`) - without this, a stacking effect could reach a `DebuffState` during the real chain resolution that never got a value table built for it, silently reading as 0% survival via the `table ? readValueTable(...) : 0` fallback. For non-stacking (idempotent) effects this widening is a no-op in practice - `applyStatEffect`'s boolean flags collapse to the same state after the first application, so the extra iterations just re-add an already-deduplicated candidate.

**Forward simulation (`resolveAttackChainForward`) needs the SAME non-exponential shape as `attackChainValue`, achieved differently.** The natural way to write this counterpart - recurse into itself per branch, exactly mirroring `attackChainValue`'s structure - looks correct and IS correct, but is a performance trap: `attackChainValue` avoids blowing up because it's memoized *by value* (a repeated `(depth, state)` key returns instantly), but a forward simulation has no single "value" to memoize - it's accumulating probability *mass* into `stats`/`next` by mutation as it goes, so a naive per-branch recursion re-walks its ~11-way branch at every depth independently, reaching up to `11^MAX_SHRED_DEPTH` calls in the worst case even though the number of *distinct* states involved stays tiny (this was caught empirically during development: a target with `boxes: 1000` - large enough that a Shred chain rarely dies out early - made the calculation hang, while `boxes: 20` finished in under 100ms, because small `boxes` prunes most of the tree via early "destroyed" termination and large `boxes` doesn't). The fix applies the exact same trick the OUTER forward-simulation loop already uses for `dist`/`next` between separate attacks: resolve the chain **one depth level at a time**, merging every state reached at that depth into a single `Map` (keyed by `fwdKey`) before resolving the next instance against it, rather than recursing per branch:

```ts
let current = new Map([[fwdKey(initialState), { state: initialState, probability }]]);
let depthRemaining = MAX_SHRED_DEPTH;
while (current.size > 0) {
  const continuing = new Map();
  for (const { state, probability } of current.values()) {
    // resolve one instance from `state`; route each surviving branch into either
    // `continuing` (if it crit-shredded) or `next` (attack k+1 onward), merging
    // probability into an existing entry by `fwdKey` rather than adding a new one
  }
  current = continuing;
  depthRemaining--;
}
```

Two different paths through the chain landing on the same `(boxes, debuffState, focusLeft, furyLeft)` are now resolved together instead of separately, so the cost stays proportional to the number of *distinct* states per depth level (small, same reasoning as `attackChainValue`'s cache) rather than the number of *paths* to reach them (exponential). `stats.hitMass`/`critMass` only accumulate at `depthRemaining === MAX_SHRED_DEPTH` (the very first level) - "Hit"/"Crit" chance are the ORIGINAL roll's own, a single well-defined probability, unlike "Avg damage" (`stats.damageMass`) which stays meaningful summed across however many instances actually fired at every level. In the **Step by step** breakdown (see the functional documentation), this is exactly what surfaces: **Avg damage** for a Critical Shred attack is the whole chain's expected total, but **Hit**/**Crit** stay the first roll's own.

**Returned result (`SequenceResult`)**:
- `steps[]`: for each attack, `hitChance`, `critChance`, and `averageDamage` (all three conditional on the target still being alive at that point in the sequence — the same `hitMass`/`critMass`/`damageMass` accumulators as the existing forward simulation loop, just normalized by `aliveMass`), plus `destroyChanceAtThisStep` (probability of destruction *exactly* at this step), `cumulativeDestroyChance`, `expectedBoxesRemaining` (**unconditional** expectation of boxes remaining after this attack, a destroyed target counting as 0 - see below). `averageDamage` is the **raw** damage from the roll (dice + POW − ARM), before any Focus/Fury mitigation — a property of the attack itself, not of the target's state at that instant. `destroyChanceAtThisStep`/`cumulativeDestroyChance` are still computed internally but aren't shown anywhere in the UI (see the functional documentation) — `expectedBoxesRemaining`, however, **is** used: `ResultsPanel`'s "Average damage" gauge computes `boxesInitial - steps.at(-1).expectedBoxesRemaining`, which is exactly the expected total damage dealt over the whole sequence precisely *because* `expectedBoxesRemaining` already treats destruction as 0 boxes rather than leaving it out of the expectation.
- `finalDestroyChance`: total probability of destruction over the whole sequence.
- `survivalDistribution`: distribution of remaining boxes, conditional on the target's survival.

**Safety guard**: `focusPoints`/`furyPoints` are capped at 10 (`MAX_RESOURCE_POINTS`) — beyond that, `computeSequenceOdds` throws an error rather than building a disproportionately large value table. The UI silently clamps input to this range before calling the engine.

**`SequenceTarget.def: number | 'KD'`.** If `def === 'KD'`, the target starts the whole sequence Knocked Down. This is handled by reusing **exactly** the mechanism already in place for a Knockdown triggered mid-sequence:
- `startsKnockedDown` (boolean, `target.def === 'KD'`) is only used to initialize the very first step's `DebuffState` (both backward and forward) to `{ ...INITIAL_DEBUFFS, knockedDown: true }` instead of `INITIAL_DEBUFFS` - the `isKnockedDownOrStationary` logic (melee only) that decides auto-hit at every step is completely unchanged and doesn't even know whether the target started downed or became so along the way.
- `baseDef` falls back to `DEF_FLOOR` (5, instead of a dummy value that's never read) when `def === 'KD'`, since ranged/magic attacks now genuinely need it for their normal roll against the downed DEF.

**`AttackRow.pow: number | '-'`** (UI component): `'-'` represents an attack that never deals damage (but can still critical hit, a critical effect like Knockdown remaining possible). Translated to `NO_DAMAGE_POW = -9999` before reaching the engine (`resolvePow` in `odds-calculator.ts`) — a POW that negative guarantees `max(0, dice + pow - arm) === 0` regardless of dice or ARM, with no engine change required.

### `odds-engine.ts` — bridge to Angular

`@Injectable({ providedIn: 'root' })` — exposes `compute()` (single attack) and `computeSequence()` (full sequence) to components via dependency injection. Contains no logic: it's purely a DI entry point, leaving the door open for caching or saved profiles later without touching the engine.

## The UI (`src/app/odds-calculator/`)

### Component split

`OddsCalculator` used to be a single monolithic component; it's now a thin **orchestrator** delegating to focused child components, split when the combined `.ts`/`.html`/`.css` passed ~1600 lines and adding attack rows started requiring scrolling the whole page (see "App shell" below for the bug that caused along the way):

```
odds-calculator/
  odds-calculator.ts/html/css     # orchestrator: owns `rows`, `target`, `sequence` computed
  attack-row.model.ts              # AttackRow domain model (shared by odds-calculator + attack-row/)
  range.util.ts, format.util.ts, select.util.ts   # tiny shared pure helpers (range, pct, toNumber)
  target-panel/                    # Target row (DEF/ARM/Boxes) + summary tags + cog button
    target-panel.model.ts           # TargetState domain model (shared by odds-calculator + target-panel/ + target-profile-dialog/)
  attack-row/                      # one attack row + its effects-summary tags
  toggle-button/                   # one .toggle-btn bound to a TriggerEffectRow (see attack-row.model.ts)
  effect-tags/                     # the pill-tag summary row (attack-row/ and target-panel/ both render through it)
  mini-field-select/               # one labelled <select> bound to a WritableSignal<T> (target-panel/ + attack-row/)
  dialog-shell/                    # shared <dialog> chrome (header/close/backdrop) for all six pop-ups below
  effects-dialog/                  # per-attack Effects pop-up
  target-profile-dialog/           # Target profile pop-up (Focus/Fury/Tough/capabilities/spells)
  details-dialog/                  # Results breakdown pop-up (step-by-step + damage distribution)
  results-panel/                   # Results gauges + "+" details button
  app-menu/                        # Header hamburger dropdown (Reset / About / Changelog / Feedback / Support me - Ko-fi link)
  about-dialog/                    # Static "what is this app" pop-up
  changelog-dialog/                # "What's new" pop-up, driven by changelog.data.ts
  feedback-dialog/                 # Feedback/bug-report form, posts to a Google Apps Script
  shared/                          # CSS partials reused by 2+ of the above (see below)
```

Every child component that owns its own popup (`EffectsDialog`, `TargetProfileDialog`, `DetailsDialog`, `AboutDialog`, `ChangelogDialog`, `FeedbackDialog`) is self-contained: it exposes `open()` directly (delegating internally to its own `DialogShell` - see "Pop-ups" below), rather than the orchestrator tracking "which dialog/row is open". The orchestrator's template calls this method through **template reference variables** (`#effectsDialogRef`, `#targetProfileDialogRef`, `#detailsDialogRef`, `#aboutDialogRef`, `#changelogDialogRef`, `#feedbackDialogRef`) rather than `@ViewChild` in the orchestrator's own class - Angular resolves a template ref variable anywhere in the same template, including from a sibling element's event binding, so no `@ViewChild` boilerplate is needed there at all. `AppMenu` follows the same "trigger elsewhere, dialog lives at the orchestrator level" shape as `TargetPanel`'s cog button: it doesn't hold any of these dialogs itself, it just emits `openAbout`/`openChangelog`/`openFeedback` outputs that the orchestrator wires straight to those template ref variables.

**Shared CSS via multiple `styleUrls`, not a single global stylesheet.** Angular components normally get their own scoped CSS file, but many classes here (`.icon-btn`, `.dialog__header`, `.toggle-btn`, ...) are used by several sibling components with identical markup. Rather than duplicating the rules by hand (risking drift) or making them globally unscoped (risking accidental collisions elsewhere in the app), each consuming component lists the relevant partial file(s) from `shared/` in its own `styleUrls` array alongside its own file. Angular bundles and scopes each partial **separately per consuming component** (each gets its own `[_ngcontent-xxx]` attribute stamped onto the rules), so a shared file can be included by five different components and each one only ever matches elements actually rendered by that component - a `.attack-row` selector inside `shared/scrollable-row.css`, for instance, simply never matches anything inside `TargetPanel`'s scoped copy of that file, since `TargetPanel`'s template has no such element. (`.mini-field`/`.effect-tag` used to be textbook examples of this too - both now live in exactly one component's `styleUrls`, `MiniFieldSelect`/`EffectTags` respectively, since nothing else renders their markup directly anymore.)

**Ordering rule for `styleUrls`: shared partials first, the component's own file last.** Angular concatenates `styleUrls` in array order; when two rules have equal CSS specificity (very common here - most of this app's classes are single-class selectors), the **later** one wins a tie, not the more "local" one. This bit us for real once (see "App shell" below): `shared/section.css`'s `.console, .readout { flex-shrink: 0; ... }` and `odds-calculator.css`'s `.console--attacks { flex: 1 1 auto; ... }` both apply to the same `<section class="console console--attacks">` element with equal specificity, and having the shared file listed *after* the component's own file silently let the shared rule win, overriding `flex-shrink` back to `0` and breaking the one section that's supposed to scroll. Every component in this split now lists its shared partials first and its own file last specifically to make local overrides always win predictably.

### `attack-row.model.ts` — the `AttackRow` domain model

Pure TypeScript (no Angular), imported by the orchestrator, `AttackRowComponent`, and `EffectsDialog`. Each row (`AttackRow`) is an object whose **every field is itself a signal** - see the "why" below. No attacker name or editable label: the label shown in the results (`Attack N`) is generated from the row's position. Base (non-effect) fields: `type`, `stat`, `diceCount`, `pow`, `damageDiceCount`.

**Every toggleable effect - general, attack-roll, damage-roll, crit-only, and genuinely hit-or-crit-triggered alike - lives in ONE fixed-size array, `triggerEffects: TriggerEffectRow[]`, rather than a mix of individually-named booleans plus a separate array.** An earlier version had 15 separate `WritableSignal<boolean>` fields (`jumpTheShark`, `blessed`, `forceAutoHit`, `discardAttackLowest`, ...) alongside `triggerEffects` for just the 13 keys that genuinely distinguish "on a hit" from "on a critical hit" (`armorPiercing`, `decapitation`, the persistent `StatEffect`s). That split meant every one of those 15 booleans got its own hand-written toggle-button block in `effects-dialog.html` - `[class.toggle-btn--active]="row.x()"`, `(click)="row.x.set(!row.x())"`, repeated with only the field name and label changing - real repetition with no structural reason for it. Unifying under one `TriggerEffectRow` shape (28 keys total now) is what let a single `ToggleButton` component (see "Pop-ups" below) replace every one of those hand-written blocks, including the 13 original ones:
```ts
interface TriggerEffectRow {
  readonly key: TriggerEffectKey;
  readonly trigger: WritableSignal<EffectTrigger | 'off'>;
  readonly amount: WritableSignal<number>; // only read for 'armPenalty'
}
```
For the 15 "simple" keys (no real hit/crit distinction at all - Jump the Shark, Discard lowest, Trash, ...), `'hit'` is simply used as the interface's generic "on" value, and the UI only ever renders ONE button for them (`ToggleButton`'s default `activeValue="hit"`). Only the 13 genuinely hit/crit-triggerable keys get a PAIR of buttons (one per group), both bound to the SAME `TriggerEffectRow` with a different `activeValue` - `ToggleButton`'s `toggle()` method implements the shared "toggle button" behavior for both cases: clicking the button for the already-active value switches the effect back to `'off'`; clicking a different value (only reachable for a pair) switches straight to it, no need to turn it off first.

`TRIGGER_EFFECT_KEYS` stays a **fixed set**, created once by `createTriggerEffects()` and never recreated during a row's lifetime (same "no add/remove-by-id machinery needed" reasoning as when the old dynamic `StatEffectRow[]` list was replaced by a fixed array - see git history) - it's just grown to cover every effect instead of only the hit/crit-triggerable ones. It's split into five exported, ordered key lists (`GENERAL_EFFECT_KEYS`, `ATTACK_EFFECT_KEYS`, `DAMAGE_EFFECT_KEYS`, `HIT_CRIT_PAIR_KEYS`, `CRIT_ONLY_SIMPLE_KEYS`) so the template can pull just the subset relevant to a given dialog section, in the right order, via `effectsFor(row, keys)`. `TRIGGER_EFFECT_LABELS: Record<TriggerEffectKey, string>` centralizes every button's display text (`ToggleButton` looks its own label up from its `effect().key` - no separate `label` input needed); a small `SUMMARY_LABEL_OVERRIDES` map covers the handful of keys whose *summary tag* text needs to differ from the button's own label (`discardAttackLowest`'s button says "Discard lowest", its tag says "Discard lowest (atk)" - the two "Discard lowest" buttons, attack-roll and damage-roll, would otherwise be indistinguishable in the tag list).

**Why signal-per-field instead of a plain array of JS objects?** With Angular signals, mutating a nested object inside a signal array doesn't trigger recalculation (a signal only detects the replacement of its own value). Two options: (a) clone the whole array on every keystroke, or (b) give each field its own signal, which `computed()` will read individually and can therefore track finely. Option (b) is chosen here: adding/removing an **attack row** replaces the `rows` array (`rows.update(...)`), but editing an effect (fixed) or any other field only touches its own signal — no deep cloning needed. The same rationale drives `TargetState` (see below).

- **`diceCount` / `damageDiceCount`**: the user directly picks the **total** number of dice rolled (2 by default), not a boost-dice count. `toBoostDice(diceCount)` performs the conversion (`max(0, diceCount - 2)`) when building the `SequencedAttack` object sent to the engine. `discardModifier(lowest, highest)` translates the pair of booleans into `{ highest?: 1, lowest?: 1 } | undefined`.
- `toSequencedAttack(row, index)`: a named function (not an inline `.map()` callback) with an explicit `SequencedAttack` return type annotation, projecting one `AttackRow` into the plain object shape the engine expects — generates the `Attack ${index+1}` label, converts `pow` via `resolvePow`, looks up each simple effect via the local `isEffectOn(row, key)` helper (built on the same `triggerOf` lookup `armorPiercing`/`decapitation` already used), assembles `effects`/`statEffects`. The orchestrator's `sequencedAttacks` computed is then just `this.rows().map((row, i) => toSequencedAttack(row, i))`.

  **TypeScript pitfall this design avoids: the "excess property" checker doesn't apply to an object literal returned by a `.map()` callback without an explicit type annotation on that callback**, even if the enclosing `computed(...)` carries an explicit generic type. An old renamed/removed field (`criticalEffects`, replaced by `effects`/`statEffects`) had once remained silently accepted by the compiler in a `{ ...criticalEffects: {...} }` literal directly inside a `.map()` even though `SequencedAttack` no longer had it - the value was simply ignored at runtime. Moving the literal into a standalone function with an explicit return type (`toSequencedAttack`) is a more robust fix than just annotating the `.map()` callback inline, since a plain function call's result is never subject to excess-property "freshness" checks in the first place - there's no loophole left to reintroduce by accident on a future edit.
- `effectsSummary(row): string[]`: builds the list of short labels ("Discard lowest (atk)", "Trash", "Crit Knockdown"...) shown under each attack row - now a single pass over `triggerEffects`, applying `SUMMARY_LABEL_OVERRIDES` where the tag text needs to differ from the button label, plus a `'Crit '` prefix whenever `trigger() === 'crit'` (never true for a simple-toggle key, since those are only ever `'off'`/`'hit'`). Brutal Damage and Critical Shred are both crit-only but rendered as simple toggles (see `CRIT_ONLY_SIMPLE_KEYS`), so that automatic prefix never reaches them either - each needs its own `SUMMARY_LABEL_OVERRIDES` entry instead (`'Crit Brutal Damage'`, `'Crit Shred'`) to read the same way as a genuine hit/crit pair's crit-side tag would, even though their BUTTON labels ("Brutal Damage", "Shred") stay short since they only ever appear in the "Critical" section to begin with - no need to repeat "Critical" in a button that's already grouped under that heading.
- `resetEffects(row)`: resets every entry in `triggerEffects` to `'off'`/amount `2` — the "base" fields (type, stat, dice, POW) are deliberately left untouched.

### `target-panel/target-panel.model.ts` — the `TargetState` domain model

Same "signal per field" structure as `AttackRow`, shared by `TargetPanel` and `TargetProfileDialog` (and read by the orchestrator to build the engine call):
```ts
interface TargetState {
  def: WritableSignal<number | 'KD'>;
  arm: WritableSignal<number>;
  boxes: WritableSignal<number>;
  resourceKind: WritableSignal<'focus' | 'fury'>; // a model has one or the other, never both
  resourcePoints: WritableSignal<number>;
  toughKind: WritableSignal<'off' | 'tough' | 'toughSteady'>; // mutually exclusive - see below
  shield: WritableSignal<boolean>;
  shieldAmount: WritableSignal<number>;
  unyielding: WritableSignal<boolean>;
  carapace: WritableSignal<boolean>;
  rapidHealing: WritableSignal<boolean>; // no dispel-pair - see target-panel.model.ts's doc comment
  spellBonuses: WritableSignal<SpellBonusRow[]>; // the one genuinely dynamic list left in this app
}
```
- **`toughKind` instead of two independent booleans**: Tough and Tough Steady are mutually exclusive by definition (Tough Steady *is* "Tough, but immune to Knockdown negation" - see `sequence.ts`), so modeling them as a single 3-state field avoids ever representing the nonsensical "both active" state. `toggleToughKind(target, kind)` in `TargetProfileDialog` mirrors `ToggleButton`'s own `toggle()` (see "Pop-ups" below): clicking the active kind's button turns it `'off'`, clicking the other switches straight to it.
- **`resourceKind` + a single `resourcePoints` instead of independent `focus`/`fury` fields**: a model is either a warcaster (Focus) or a warlock (Fury), never both, so two independent point counts could represent a nonsensical "has both" state that the tabletop game itself doesn't allow. The two `.toggle-btn`s in the dialog set `resourceKind` directly (`t.resourceKind.set('focus')`/`set('fury')`) rather than going through a toggle-to-`'off'` helper like `toughKind` does, since there's no "neither" state here — one of the two is always selected, and `resourcePoints` alone controls whether the resource actually matters (0 points reads as "no summary tag", see `targetSummary`). The orchestrator's `sequence` computed reads `resourceKind` to route `resourcePoints` into whichever of the engine's `focusPoints`/`furyPoints` fields is active, always zeroing the other out.
- **`SpellBonusRow`** is the one place in this app that's still a genuinely dynamic, repeatable list (like the old, since-removed `StatEffectRow` list) rather than a fixed set — because spells can't be enumerated by name (see the functional documentation for why). A row is either a flat stat bonus or a granted rule, never both (`kind` picks which fields are read), plus a free-text `name` and a `dispellable` boolean read by every attack's Dispel effect (see `sequence.ts`'s `*PostDispel` fields):
  ```ts
  type SpellBonusKind = 'stat' | 'rule';
  type SpellStatType = 'def' | 'arm';
  type SpellRuleKind = 'tough' | 'toughSteady' | 'shield' | 'unyielding' | 'carapace';

  interface SpellBonusRow {
    readonly id: string;
    readonly name: WritableSignal<string>;
    readonly kind: WritableSignal<SpellBonusKind>;
    readonly statType: WritableSignal<SpellStatType>; // read only when kind === 'stat'
    readonly statAmount: WritableSignal<number>;       // read only when kind === 'stat'
    readonly ruleKind: WritableSignal<SpellRuleKind>;  // read only when kind === 'rule'
    readonly dispellable: WritableSignal<boolean>;
  }
  ```
  **`kind === 'rule'` is always dispellable, enforced in the component, not the model.** `TargetProfileDialog.setSpellKind(spell, kind)` calls `spell.dispellable.set(true)` whenever `kind` switches to `'rule'`, and the template disables (but still shows checked) the Dispellable checkbox in that case. The model itself doesn't enforce this invariant (`SpellBonusRow` has no setter of its own, just raw signals) - the doc comment on the interface calls this out explicitly as a reason: *"a permanent, non-dispellable rule should just be toggled directly in Special rules instead of modeled as a spell"*, so there's deliberately no way to reach the "permanent rule granted via a spell" state through the UI.
- **Reusing the "Special rules" toggles for spell-granted rules, rather than giving `SpellBonusRow` its own copy of Tough/Shield/Unyielding/Carapace logic.** A spell of `kind: 'rule'` doesn't carry its own ARM amount, its own melee/ranged condition, or its own Tough/Tough Steady exclusivity - it just names one of the same five rules already modeled on `TargetState` (`ruleKind: SpellRuleKind`), and helper functions resolve "either toggled directly or granted by some spell" once, in one place:
  ```ts
  function grantsRule(target: TargetState, rule: SpellRuleKind): boolean {
    return target.spellBonuses().some((s) => s.kind() === 'rule' && s.ruleKind() === rule);
  }
  export function effectiveUnyielding(target: TargetState): boolean {
    return target.unyielding() || grantsRule(target, 'unyielding');
  }
  // effectiveCarapace: same OR pattern.
  export function effectiveToughKind(target: TargetState): ToughKind {
    if (target.toughKind() !== 'off') return target.toughKind();
    if (grantsRule(target, 'toughSteady')) return 'toughSteady';
    if (grantsRule(target, 'tough')) return 'tough';
    return 'off';
  }
  ```
  An innate toggle always takes priority in `effectiveToughKind` (an odd double-grant of Tough Steady and plain Tough should still read as Tough Steady, not silently downgrade). The orchestrator's `sequence` computed calls these `effective*` functions - rather than reading `target.toughKind()`/`target.unyielding()`/`target.carapace()` directly - for the engine's PRE-Dispel fields, and the raw signals directly for the POST-Dispel fields (see `sequence.ts`'s "Target capabilities" section for why that split is always exactly "effective vs innate-only" and never needs finer filtering). **There's no `effectiveShield`**: unlike the other four, Shield isn't offered as a spell-grantable rule in the current UI (`SPELL_RULE_OPTIONS` only lists `'tough'`/`'unyielding'`), so `shieldArmBonus` (below) reads `target.shield()` directly - an `effectiveShield` that could never actually differ from the raw signal would just be dead code.
- **`shieldArmBonus(target)`**: `target.shield() ? target.shieldAmount() : 0` - deliberately the innate signal only, per the note above.
- **`spellArmBonus(target)` / `spellArmBonusPostDispel(target)` / `spellDefBonus(target)` / `spellDefBonusPostDispel(target)`**: sum every **`kind: 'stat'`** spell bonus's matching-`statType` component into the flat numbers the engine's `SequenceTarget.spellArmBonus`/`spellArmBonusPostDispel`/`defBonus`/`defBonusPostDispel` expect (see `sequence.ts`) - the `PostDispel` variants additionally filter on `!dispellable()`, via a shared private `statSpells(target, statType, dispellableOnly)` helper so the four exported functions are each a one-line call. Unyielding/Carapace stay conditional on attack type and are resolved fresh per attack by the engine itself, never pre-summed here.
- `targetSummary(target)`: same role as `effectsSummary(row)`, producing the tag list shown under the Target row (`Focus 2`, `Tough Steady`, `Shield +2 ARM`, `Arcane Shield (+3 ARM) [Up]`, `Iron Zeal (Unyielding) [Up]`, ...). Still reads the raw `target.toughKind()`/`target.shield()`/`target.unyielding()`/`target.carapace()` (not the `effective*` variants) for the direct-toggle tags, since a spell-granted rule already gets its own tag from the per-spell loop - using `effective*` here would print the same rule twice when both an innate toggle and a spell grant it.
- `resetTargetProfile(target)`: resets everything **except** `def`/`arm`/`boxes` (which live outside the popup, in `TargetPanel`'s own row).

### Numeric fields as `<select>` rather than `<input type="number">`

Every field with a known range (DEF, ARM, Boxes, Focus/Fury points, MAT/RAT/AAT, POW, Dice, Shield amount, spell stat bonus amount) is a `<select>` rather than an `<input type="number">`, so that picking a value opens a native picker on mobile instead of the keyboard. The option lists are generated once via `range(start, end)` (`range.util.ts`).

**`MiniFieldSelect` (`mini-field-select/mini-field-select.ts`)** - one `.mini-field` labelled `<select>`, covering the Target row's DEF/ARM/Boxes and each attack row's Type/MAT-RAT-AAT/Dice/POW/Dice: the same shape 8 times over (a label, a `<select>` looping over a fixed options array, writing back through a string-to-value parser), previously hand-written at every one of those 8 call sites. A **generic** component (`MiniFieldSelect<T>`), since the value type genuinely differs per field - `number` (ARM/Boxes/MAT-RAT-AAT/Dice), `number | 'KD'` (DEF), `number | '-'` (POW), `AttackType` (Type):
```ts
readonly label = input.required<string>();
readonly signal = input.required<WritableSignal<T>>();
readonly options = input.required<readonly T[]>();
readonly narrow = input(false);
readonly parse = input<(raw: string) => T>((raw) => raw as unknown as T);
```
Takes the `WritableSignal<T>` itself (`[signal]="target().def"`, `[signal]="row().stat"`, ...) rather than a value/output pair, matching how every other signal-per-field domain model in this app (`AttackRow`, `TargetState`) is already read and written directly wherever it's used - the template binds `[ngModel]="signal()()"` / `(ngModelChange)="signal().set(parse()($event))"` internally. `parse` defaults to a plain cast, which is exactly correct for `Type`'s own select (a `<select>` change event is already the right string, nothing to convert) - every numeric field passes `toNumber`, `parseDef`, or `parsePow` explicitly instead. `label` is a plain string input, but MAT/RAT/AAT's OWN label is data-dependent (`statLabel(row().type())`), so it's passed as a property binding (`[label]="statLabel(row().type())"`) rather than a static attribute like the other 7 - the component itself doesn't need to know or care which.

`shared/mini-field.css` moved out of `TargetPanel`'s and `AttackRowComponent`'s own `styleUrls` - now only `MiniFieldSelect` needs it, the same reasoning as `EffectTags`/`shared/effect-tags.css` above. Confirmed empirically that using `MiniFieldSelect` as a genuine child component (not content projection) doesn't disturb `.target-row`/`.attack-row`'s existing `align-items: flex-end` layout: `<app-mini-field-select>` becomes the actual flex item now instead of `.mini-field` directly, but since it renders exactly one child with no extra sizing of its own, its box is pixel-identical to `.mini-field`'s own - unlike `DialogShell`'s cross-component CSS pitfalls (this refactor doesn't need any combinator selector spanning `MiniFieldSelect`'s own template and its parent's, so that whole class of bug doesn't apply here).

**Pitfall to know about: `<select>` + `ngModel` always communicates in strings.** A native `<select>` only ever knows `value`s of type `string`; `(ngModelChange)` therefore always emits a string, never a number, even when `[ngModel]` is fed a number. Each binding explicitly converts back: `toNumber(raw)` (`select.util.ts`) for regular numeric fields, and `parseDef`/`parsePow` for DEF/POW, which additionally accept a sentinel value (`'KD'`, `'-'`) that must absolutely not be converted to a number.

### Actions

- `addAttack()`: adds a row by cloning the last row's values (`cloneAttackRow`, fresh signals initialized to the same value - no shared reference with the source row, including a deep clone of `triggerEffects`), or a default row (`createAttackRow`) if there isn't one yet.
- `removeAttack(id)`: removes a row (at least 1 row always remains).

No button to reorder rows (removed: see functional documentation) - the order is built solely by adding attacks in the intended order.

### Pop-ups (Effects / Target profile / Details)

Per-attack special effects, the target's resource points/capabilities/spells, and the results breakdown are moved into pop-ups rather than shown permanently, to keep the attack row, Target row, and results summary compact.

Implementation: the native HTML **`<dialog>`** element (no modal/CDK library), wrapped in a shared **`DialogShell`** component (`dialog-shell/dialog-shell.ts`) rather than each of the six dialogs (Effects, Target profile, Details, About, Changelog, Feedback) owning its own `<dialog>` directly - this used to be a block of markup (the `<dialog>`, its click-outside-to-close handling, and the header/close-button) hand-copied verbatim into all six, along with the `open()`/`close()`/`closeOnBackdropClick()` methods behind it.

**`DialogShell`**: takes `title` (required), `wide` (the `dialog--wide` width modifier - Details), and `framed` (the "fixed header/footer, only the middle scrolls" layout - Effects, Target profile) inputs, and exposes `open()`/`close()`. Each consuming dialog component holds a `@ViewChild('shell') private shell?: DialogShell` and delegates its OWN public `open()` to `this.shell?.open()` - callers OUTSIDE these components (the orchestrator's template, `AppMenu`) don't change at all, since every dialog still exposes `open()` the same way it always did. There's no equivalent public `close()` left on any of the six anymore: nothing outside a dialog's own template ever called it (every call site turned out to be the dialog's own close/done/cancel button), so a dialog's projected content just calls `shell.close()` directly via the `#shell` template reference variable, which content projection keeps in scope for everything nested inside `<app-dialog-shell #shell>...</app-dialog-shell>` in that dialog's own template.
- `EffectsDialog` additionally holds `protected readonly row = signal<AttackRow | null>(null)`, set by `open(row)` - a single pop-up instance is reused for every attack row (rather than one per row). `TargetProfileDialog` doesn't need an equivalent signal: there's only ever one target, so it takes `target` as a plain `input.required<TargetState>()` and `open()` takes no argument.
- `closeOnBackdropClick(event, dialog)` now lives ONCE, inside `DialogShell` itself: for a `<dialog>` opened in modal mode, a click on the `::backdrop` bubbles up a `click` event whose `target` is the `dialog` element itself (not a child) — this property lets us distinguish "click on the backdrop" from "click inside the content" without `stopPropagation()`. The Escape key closes the pop-up natively, with no extra code.
- **A footer (Reset/Done, Cancel/Send, ...) is projected into `DialogShell` via a `dialogActions` attribute** on the consumer's own wrapping `<div>`, matched by `<ng-content select="[dialogActions]" />` in `dialog-shell.html`; everything else projects into the default slot. Two things worth remembering if this pattern gets reused elsewhere:
  - **`<ng-content>` for one selector must appear exactly ONCE in the shell's template, not once per branch of an `@if`/`@else`.** An earlier version had `@if (framed()) { <div class="dialog__body"><ng-content /></div> } @else { <ng-content /> }` - two separate default-slot `<ng-content>` tags, one per branch - and NEITHER ever received any projected content (confirmed empirically: `.dialog__body` rendered with zero children, in every dialog, framed or not). The fix keeps a single `<ng-content />`, toggling `.dialog__body`'s presence via `[class.dialog__body]="framed()"` on an unconditionally-rendered wrapper `<div>` instead of branching the `<ng-content>` itself.
  - **A projected `[dialogActions]` element must be the ONLY root node of whatever `@if`/`@for`/`@else` block contains it** (Angular diagnostic NG8011). `EffectsDialog`'s body content and its `dialogActions` footer both used to live inside the SAME `@if (row(); as row) { ... }` block; with several other root nodes alongside it, that block's content silently fell back to the DEFAULT slot instead of the named one. The fix splits it into two separate, sibling `@if (row(); as row) { ... }` blocks - one for the body (many root nodes, fine, since none of them need to reach a named slot), one containing only the `dialogActions` div (exactly one root node, so it routes correctly). `FeedbackDialog`'s `@if (state() === 'sent') { ... } @else { ... }` needed the same split, doubled up per branch.

**Content of the Effects pop-up**, organized into sections (see the functional documentation for the details of each effect), each rendering a `<app-toggle-button>` (see below) per relevant `TriggerEffectRow`, pulled via `effectsFor(row, keys)`:
- "General": `effectsFor(row, generalEffectKeys)` → Jump the Shark (a single button, which drives both the to-hit roll and the damage roll), Blessed (resolved by `sequence.ts`'s `profileFor` - see "Target capabilities").
- "Attack": `effectsFor(row, attackEffectKeys)` → Auto-hit, Discard lowest, Discard highest, Reroll, Sanguine Fate — since each is its own independent `TriggerEffectRow`, Discard lowest and Discard highest can be active together with no special coordination logic.
- "Damage": `effectsFor(row, damageEffectKeys)` → Discard lowest, Discard highest, Reroll, Trash, Shatter, Chain Weapon (same resolution point as Blessed) — same principle on the damage side.
- "On hit": `effectsFor(row, hitCritPairKeys)`, each `<app-toggle-button [effect]="effect" activeValue="hit" />`. `Dispel` and `Grievous Wounds` needed no template change at all to appear here - each is just another `StatEffectType` added to `STAT_EFFECT_TYPES` in `attack-row.model.ts`, and `HIT_CRIT_PAIR_KEYS` (built from `STAT_EFFECT_TYPES`) picks it up generically.
- "Critical": the SAME `effectsFor(row, hitCritPairKeys)` list again, this time `activeValue="crit"` (each button pair shares one `TriggerEffectRow` - see `ToggleButton` below), followed by `effectsFor(row, critOnlySimpleKeys)` → Brutal Damage, Shred, each a single (default `activeValue="hit"`) button, since neither has an "On hit" variant. Both buttons keep a short label ("Shred", not "Critical Shred") since they only ever appear here, already grouped under the "Critical" heading - their summary tags say "Crit Brutal Damage"/"Crit Shred" instead, matching how every other crit-triggered effect's tag reads (see `effectsSummary` above).
- Amount for `-X ARM`: `@let armPenalty = armPenaltyEffect(row);` then `@if (armPenalty.trigger() !== 'off')` shows a regular `<select>` (not a toggle button - it's an amount, not a boolean) bound to `armPenalty.amount`. `armPenaltyEffect(row)` does a `.find(e => e.key === 'armPenalty')` on the fixed array - always present, hence the non-null `!` in its return type signature.
- "Reset" (`resetEffects(row)`) and "Done" (`shell.close()`) side by side at the bottom of the pop-up (`.dialog__actions`, `flex: 1 1 0` each).

**`ToggleButton` (`toggle-button/toggle-button.ts`)** - one `.toggle-btn` / `.toggle-btn--active` (defined in `shared/dialog-sections.css`, listed in this component's own `styleUrls` too - see "Component split" above for why a shared partial needs re-listing per consumer) bound to a `TriggerEffectRow`:
```ts
readonly effect = input.required<TriggerEffectRow>();
readonly activeValue = input<EffectTrigger>('hit');
protected readonly label = computed(() => TRIGGER_EFFECT_LABELS[this.effect().key]);
protected readonly active = computed(() => this.effect().trigger() === this.activeValue());
```
`toggle()` clicks the already-active value back to `'off'`; clicking a different value (only reachable when a pair renders the SAME effect twice, once per `activeValue`) switches straight to it. This one component is EVERY toggle button in the Effects pop-up now - the simple ones (default `activeValue="hit"`, rendered once) and the hit/crit pairs (rendered twice, `activeValue="hit"` and `activeValue="crit"`) alike - replacing what used to be a hand-written `[class.toggle-btn--active]="row.x()"` / `(click)="row.x.set(!row.x())"` block repeated per effect. No separate `label` input: it looks its own label up from `TRIGGER_EFFECT_LABELS[effect().key]`, since that map already has to exist for `effectsSummary`'s sake.

**`EffectTags` (`effect-tags/effect-tags.ts`)** - the small pill-tag row shown under an attack row (`effectsSummary(row)`) and under the Target row (`targetSummary(target)`): identical markup and CSS (`shared/effect-tags.css`) in both places, so both now render through this one component instead of each carrying its own copy of `@if (summary(...).length > 0) { <div class="effect-tags">@for (tag of summary(...); track tag.key) { <span class="effect-tag">{{ tag.label }}</span> } }`. Takes a single `tags = input.required<readonly EffectTag[]>()`, where `EffectTag` (`{ key: string; label: string }`) is a deliberately minimal shape - `effectsSummary`'s own `EffectSummaryTag` (`key: TriggerEffectKey`) and `targetSummary`'s `TargetSummaryTag` (`key: string`) both satisfy it structurally without either needing to import from the other's domain model. `shared/effect-tags.css` moved out of `AttackRowComponent`'s and `TargetPanel`'s own `styleUrls` - now only `EffectTags` itself needs it, since the `.effect-tags`/`.effect-tag` elements are entirely inside `EffectTags`'s own template, not projected from its callers (unlike `DialogShell`'s `dialogActions` slot - there's no content projection here at all, just a plain `tags` input).

**Content of the Target profile pop-up (`TargetProfileDialog`)** follows the same general "toggle-button pop-up" shape, but its own booleans (`shield`, `unyielding`, `carapace`, `rapidHealing` on `TargetState`) are a different domain with no `TriggerEffectRow`/hit-crit concept at all, so they're still hand-written toggle buttons rather than `<app-toggle-button>` instances:
- "Resources": a Focus/Fury `.toggle-group` (see `resourceKind` above) and the single "Points" `<select>` sit in one `.resource-row` (`display: flex; align-items: center;` in `target-profile-dialog.css`, overriding `.toggle-group`'s own `margin-bottom` to 0 via the compound selector `.resource-row .toggle-group` so the two controls line up on one row instead of stacking).
- "Special rules": Tough / Tough Steady (mutually exclusive via `toggleToughKind`, see `TargetState` above), Shield (amount select appears once active, same pattern as `-X ARM`), Unyielding, Carapace, Rapid Healing — all six toggles share one `.toggle-group` section.
- "Spells": the one dynamic, repeatable list in the app - `@for (spell of t.spellBonuses(); track spell.id)` rendering a `.spell-row` split across two `.spell-row__line`s (a single nowrap line overflowed even the widest dialog once the Rule/Dispellable controls were added): line 1 is the name text input + a "Bonus type" `<select>` (Stat/Rule, `setSpellKind(spell, $event)`); line 2 conditionally shows either the Stat pair (amount `<select>` + DEF/ARM `<select>`) or the Rule `<select>` (`spellRuleOptions`/`spellRuleLabels`, from `target-panel.model.ts` - deliberately narrowed to just `['tough', 'unyielding']`, even though the underlying `SpellRuleKind` type and the engine's `effective*` helpers support all five rules, since Tough Steady/Shield/Carapace are almost always innate model rules rather than spell-granted) via an `@if (spell.kind() === 'stat') { ... } @else { ... }`, then the Dispellable checkbox (`[disabled]="spell.kind() === 'rule'"`, see `SpellBonusRow` above), then a remove button pushed to the line's end (`.spell-row__remove { margin-left: auto; }`). Consecutive spell entries get a separator (`.spell-row + .spell-row { border-top: ... }` - the adjacent-sibling combinator naturally skips the first entry) mirroring the border between attack rows. A `+ Add spell` button follows (`addSpellBonus`/`removeSpellBonus`, both simple `array.update()` calls, same shape as `addAttack`/`removeAttack`).
- "Reset" (`resetTargetProfile(t)`) / "Done" (`shell.close()`).

  **`@let t = target();` rather than `@let target = target();`**: since `target` is both the component's `input.required<TargetState>()` signal AND the natural name for its unwrapped value, naming the `@let` the same as the input causes `NG8016: Cannot read @let declaration 'target' before it has been defined` (the RHS `target()` call resolves against the *new* `@let` binding being declared, not the outer input signal, so it doesn't even reach the real input). Using a differently-named local (`t`) sidesteps the collision entirely.

**Buttons within a given category sit in a `flex-wrap: wrap` container (`.toggle-group`)**, rather than `nowrap` like the Target/Attack rows: unlike those (a fixed, known number of fields), the number of active effects/capabilities is open-ended, so a pop-up needs to be able to accommodate any combination by wrapping, without ever widening the `<dialog>` (whose width stays capped at `width: min(90vw, 480px)`, unchanged).

**Fixed header/footer, scrolling body (`.dialog__content--framed` + `.dialog__body`, both in `shared/dialog-sections.css`).** Both the Effects and Target profile pop-ups keep their header (title + close button) and footer (Reset/Done) in place while only the sections in between scroll:
- `.dialog__content--framed` turns the container into a `display: flex; flex-direction: column; overflow: hidden;` box; its direct-child header and `.dialog__actions` footer get `flex-shrink: 0`.
- The middle content is wrapped in a `.dialog__body` div with `flex: 1 1 auto; min-height: 0; overflow-y: auto;`, so it's the only part that scrolls once it overflows the dialog's `max-height: 80vh`.
- Since the first section title now sits inside `.dialog__body` right after the header rather than directly after it, `.dialog__body > .dialog__section-title:first-child` removes that first title's own top border/margin/padding — otherwise it would show its own separator line just below the header's bottom border, reading as a doubled line a few pixels apart.
- `DetailsDialog` doesn't use this modifier (its `.dialog__content` scrolls as a single block) since it has no fixed footer to protect.

### `AppMenu` — the header hamburger dropdown

Unlike every other pop-up in this app, `AppMenu`'s dropdown is **not** a native `<dialog>` - it's a plain `position: absolute` panel anchored under the ☰ trigger button, toggled by a signal (`isOpen`). A short, fixed list of actions doesn't need a `<dialog>`'s backdrop/focus-trap semantics, and a full-screen modal for a handful of menu items would be heavier than the content warrants. Two consequences of not being a `<dialog>`:
- **No `::backdrop` to catch an outside click**, so `AppMenu` binds Angular's global event syntax directly in the template - `(document:click)="onDocumentClick($event)"` and `(document:keydown.escape)="close()"` - rather than relying on the `closeOnBackdropClick` pattern every other pop-up uses. `onDocumentClick` walks the click's `target` up against the menu's own root element (`@ViewChild('menuRoot')`) via `Node.contains()`; the click that *opens* the menu (on the trigger button, itself inside `menuRoot`) also reaches this handler through the same bubbling, but since its target is contained within `menuRoot` it's correctly treated as "inside" and doesn't immediately re-close what `toggle()` just opened.
- **These global listeners still integrate with zoneless change detection** the same way a plain template `(click)` binding does: Angular's own event-binding instructions (not zone.js) are what schedule change detection after a listener runs, and that applies equally to `document:`/`window:`-scoped global listeners declared in a template, not just element-scoped ones - no special handling was needed here.

`AppMenu` itself owns none of these actions - it only emits `reset`/`openAbout`/`openChangelog`/`openFeedback` outputs and closes itself, mirroring how `TargetPanel`'s cog button emits `openProfile` rather than owning `TargetProfileDialog` (see "Component split" above). One item is the odd one out, not going through an output: "Support me" is a plain `<a>` styled as `.app-menu__item` linking straight to Ko-fi - there's no state or dialog behind it, just a URL, so wiring it through `OddsCalculator` the way the other three are would've been indirection for its own sake.
- **Reset** (`OddsCalculator.resetAll()`): calls the new `resetTargetFully(target)` (`target-panel.model.ts`) - unlike `resetTargetProfile` (used by the Target profile pop-up's own Reset, which deliberately leaves DEF/ARM/Boxes alone since those live outside that pop-up), this additionally sets `target.def`/`arm`/`boxes` back to their defaults (`DEFAULT_DEF`/`DEFAULT_ARM`/`DEFAULT_BOXES`, now named constants shared between `createTargetState` and `resetTargetFully` so the two can't silently drift apart) - then `rows.set([createAttackRow()])` collapses the attack sequence back to one default row. No confirmation step, matching every other Reset button in the app.
- **About** (`AboutDialog`): a static-content pop-up, no signals or inputs of its own - just the plain `<dialog>`/`open()`/`close()`/`closeOnBackdropClick` shape every other dialog component uses, with a block of copy in its template instead of form controls. It's also the one dialog in the app that can open itself, unprompted: `ngAfterViewInit` checks `localStorage.getItem('chancemachine.hasSeenAbout')`, and if that key is unset, sets it and calls its own `open()` - a first-time visitor sees the explanation without having to find the menu, and it never fires again on that device/browser afterward (regardless of whether that first pop-up was actually read, or how quickly it was closed - the flag is set unconditionally the moment it auto-opens, not on some "did they engage with it" heuristic). `ngAfterViewInit` specifically (not the constructor) is what guarantees `@ViewChild('dialog')` has already resolved by the time this runs, since `open()` needs the native `<dialog>` element to exist in the DOM to call `showModal()` on it. Manually opening About from the menu goes through the same `open()` but never touches the localStorage key either way. `HAS_SEEN_ABOUT_KEY` is exported (not a private module-level string) specifically so `ChangelogDialog` can read it - see below.
- **Changelog** (`ChangelogDialog`): see below.
- **Feedback** (`FeedbackDialog`): see below.

### `ChangelogDialog` — "what's new", and the versioning scheme behind it

There's no version number anywhere else in this app (`package.json`'s `"version": "0.0.0"` is never read at runtime) - `changelog-dialog/changelog.data.ts` IS the versioning scheme: a hand-maintained, newest-first array of `{ date, items }` entries, and `LATEST_CHANGELOG_DATE` (simply `CHANGELOG[0].date`) is the single source of truth for "what's the current version". A visitor's progress is tracked the same way, as a plain ISO date string in `localStorage['chancemachine.lastSeenChangelogDate']` - "have they seen everything" is just a string comparison (`lastSeen >= LATEST_CHANGELOG_DATE`) between the two, no separate incrementing counter or semver needed. Adding a new entry to `CHANGELOG` (with today's date, newest-first) is the entire mechanism for "there's something new to show" - nothing else needs to change.

**Auto-opens like `AboutDialog`, but with an extra rule: never on a visitor's very first ever load.** On that load `AboutDialog` already covers "what is this app", and dumping the ENTIRE changelog history on someone who's never used any earlier version would be noise, not news - so that visit just silently records `LATEST_CHANGELOG_DATE` without ever showing the pop-up, exactly as if they'd already seen it (a returning visitor later that day would then correctly see nothing new, not the full history retroactively).

Telling "first ever load" apart from "returning visitor, been a while" means checking the SAME `HAS_SEEN_ABOUT_KEY` `AboutDialog` uses (imported from `about-dialog.ts`, not duplicated as a second magic string) - but this read has to happen BEFORE `AboutDialog`'s own `ngAfterViewInit` can have set it (that's what "was it *already* set" means), and `ngAfterViewInit` is the wrong place to do that: an earlier version of this code deferred the read into a `queueMicrotask(...)` inside `ChangelogDialog.ngAfterViewInit`, reasoning that every sibling's synchronous `ngAfterViewInit` for one change-detection pass - including `AboutDialog`'s - completes before any microtask runs. That reasoning was backwards in practice: `AboutDialog.ngAfterViewInit` sets the key *before* returning on a visitor's very first ever load, so by the time the deferred microtask ran, it always observed the POST-set value and concluded "not their first visit" on every load, including the very first one - both dialogs auto-opened, stacked on top of each other (only caught after shipping, once actually used in a browser - `document.querySelector('dialog[open]')` in earlier manual verification only checked the first match in document order, silently missing the second one).

The fix reads it in the **constructor** instead (as a class field initializer, `private readonly wasAlreadySeenAbout = hadAlreadySeenAbout()`): Angular constructs every component in a view tree - running every field initializer/constructor body - before running ANY of their `ngAfterViewInit` hooks, for the WHOLE tree, a strict phase separation rather than an ordering convention. This is guaranteed to see the value from before this page load's dialogs ran, regardless of `<app-about-dialog>`'s position relative to this component in `odds-calculator.html`, unlike either the `ngAfterViewInit`-microtask attempt above or a plain synchronous read inside `ngAfterViewInit` (same bug, no microtask needed to trigger it).

Reading `localStorage` in the constructor reintroduces the OTHER problem an even earlier version of this code hit: `app.spec.ts`'s `should create the app` test calls `TestBed.createComponent(App)`, which DOES run every component's constructor (unlike `ngAfterViewInit`, which needs `fixture.detectChanges()` - never called in that test), and this project's Vitest/Node test environment doesn't provide a working `localStorage` that early (a Node 25 quirk - see the `--localstorage-file` warning in `ng test` output), throwing `TypeError: localStorage.getItem is not a function`. `hadAlreadySeenAbout()` (the free function `ChangelogDialog` calls for this) wraps the read in a try/catch, falling back to `true` ("assume already seen", i.e. never auto-open) if it throws - a real browser always has a working `localStorage`, so the catch branch only ever matters for that test, and "can't tell" failing safe as "don't auto-open" is a reasonable default regardless.

### `FeedbackDialog` — posting to a Google Apps Script Web App

The app has no backend of its own (it's a static PWA), so the Feedback form posts to a **Google Apps Script Web App** bound to a spreadsheet - `google-apps-script/feedback.gs` at the repo root (NOT part of the Angular build; its header comment documents the paste-and-deploy setup) exposes a `doPost(e)` that appends one row per submission (timestamp, type, message, email, page URL, user agent) to a "Feedback" sheet, creating that sheet with a header row on first use, and also sends a notification email (`MailApp.sendEmail`, `replyTo` set to the sender's email when they left one) so a submission doesn't just sit unnoticed in the spreadsheet.

`FEEDBACK_ENDPOINT_URL` is a module-level constant in `feedback-dialog.ts` holding the deployed Web App URL (`.../exec`) from `feedback.gs`'s own setup steps.

**`mode: 'no-cors'`, not `'cors'` - a deliberate, necessary tradeoff, not an oversight.** Apps Script Web Apps don't reliably send back `Access-Control-Allow-Origin` headers a cross-origin `fetch` can read, so requesting in `'cors'` mode fails outright even when the script executes correctly server-side; `'no-cors'` is the standard, documented workaround for calling Apps Script from client-side JS. The cost: the response becomes **opaque** - `submit()`'s `await fetch(...)` resolving only means the request left the browser, not that `doPost` actually ran or wrote the row (a wrong URL, an undeployed script, or an error inside `doPost` won't surface as a caught exception here, only a genuine network failure will). The UI is deliberately honest about this asymmetry: a successful `fetch` shows "Thanks! Your message has been sent" (optimistic), and only a thrown exception - not a script-side failure - shows the retry notice.

### App shell: title/Target/Results fixed, only Attack sequence scrolls

The orchestrator is structured as a three-zone app shell stacked in a fixed-height container (`height: 100dvh` on `.page`, propagated via `display:flex; flex-direction:column; height:100%` on `:host` then `.panel`, `.panel__body`): `<app-target-panel>` and `<app-results-panel>` (each a direct flex child of `.panel__body`) get `flex-shrink: 0; min-width: 0;` **on their own host element** (`:host { display: block; flex-shrink: 0; min-width: 0; }` in each component's own CSS) so they keep their natural size, and only `.console--attacks` (still a plain `<section>` in the orchestrator's own template, not extracted into a component) carries `flex: 1 1 auto; min-height: 0`, occupying all the remaining space between them. Inside it, it's `.attack-list` (not the whole section) that has `overflow-y: auto` - the "Attack sequence" title and the "+ Add attack" button therefore stay visible above and below the scrolling list. Similarly, `AttackRowComponent`'s own host element (not `.attack-row-group` nested inside it) is now the actual flex item inside `.attack-list`, so it needs its own `:host { display: block; flex-shrink: 0; }`, and the "no border on the last row" rule became `:host(:last-child) .attack-row-group { border-bottom: none; }` (the `:host(<selector>)` functional form - plain `:host:last-child` without the parens isn't valid CSS Scoping syntax and Angular won't transform it correctly).

**`min-height: 0` is essential at every level of this flexbox chain.** Without it, a flex item in a column refuses by default to shrink below its content's height (the same `min-*:auto` pitfall as for the width of compact rows, see below) - which would have prevented `.attack-list` from ever being smaller than its content, and therefore from ever scrolling: the whole page would have grown taller instead. This is exactly the regression the `styleUrls` ordering bug (see "Component split" above) caused: a shared rule silently overriding `flex-shrink` back to `0` on `.console--attacks` broke this chain, and the symptom looked identical to a missing `min-height: 0` even though the actual cause was cascade order, not a missing rule.

`100dvh` rather than `100vh` on `.page` (`app.css`): on mobile, the browser's address bar appears/disappears while scrolling, which changes the actually visible height. `100vh` is computed against the maximum height (bar hidden), which can leave the bottom of the screen (here, Results) partially hidden behind the address bar when it's visible; `dvh` (*dynamic* viewport height) tracks the actually visible height at all times. `100vh` is kept as the first-written fallback for browsers that don't support `dvh`.

**`--app-height` (`app.ts`), a JS-computed height that wins over `100dvh` once set.** An earlier fix for the installed PWA disabled the browser's pull-to-refresh gesture entirely (`html { overscroll-behavior-y: none; }` in `src/styles.css`) because, on some Android WebView versions, that gesture's reload triggered a `dvh` recalculation glitch that left the fixed layout mis-sized until the user manually scrolled. That traded away a real feature: pull-to-refresh is also how a user manually forces the installed PWA to pick up a newly-deployed version, since the Angular service worker (`ngsw`, `app.config.ts`) only activates an already-downloaded update on the next full navigation, not automatically. The actual fix addresses the root cause instead of avoiding the gesture: `App`'s constructor sets a `--app-height` custom property from `window.visualViewport.height` (falling back to `window.innerHeight` where `visualViewport` isn't supported), refreshed on every `visualViewport`/`window` `resize` event, and `.page` uses `height: var(--app-height, 100dvh)` - the JS-driven value taking priority over the plain `100dvh` declaration once it's set, with `100dvh` remaining the fallback for the brief window before JS runs on first paint. `visualViewport.resize` fires reliably when the address bar (or an on-screen keyboard) changes the visible area, which is more consistent across WebView versions than relying on `dvh` to recompute on its own - so the layout now stays correct through a pull-to-refresh reload, and the gesture itself is left enabled (`overscroll-behavior-y` back to its default `auto`).

### Hidden scrollbars

`.target-row`, `.attack-row` (horizontal scrolling, `shared/scrollable-row.css`) and `.attack-list` (vertical scrolling, in the orchestrator's own CSS) hide their scrollbar (`scrollbar-width: none` + `::-webkit-scrollbar { display: none }`) while remaining scrollable (mouse/trackpad/touch) - a visible scrollbar would have ended up right under/next to the fields' digits and visually cluttered them.

### Compact rows, centered and spaced, fitting on a single line (mobile included)

The Target row and each attack row use `flex-wrap: nowrap` rather than `wrap`: the goal is for everything to fit on a single line even on a narrow phone, scrolling horizontally rather than wrapping to a new line if needed. Fields are centered horizontally on the row (`justify-content: safe center` on `.target-row`/`.attack-row`) with generous `gap` between them; the values inside each field are themselves centered (`text-align`/`text-align-last: center` on `.mini-field__input`, `align-items: center` on `.mini-field`). Both rows share the exact same rule block, defined once in `shared/scrollable-row.css` (see "Component split" above for why a shared partial file rather than duplicated CSS).

The `safe` keyword in `justify-content: safe center` avoids a known pitfall: with a plain `center`, if the row ends up overflowing (a very narrow viewport, or more fields added later), the start of the content can become unreachable by scrolling in some browsers - `safe` falls back to `start`-like alignment in that specific case, so horizontal scrolling (`overflow-x: auto`) can always reveal everything.

**Vertical alignment of controls (`--control-h`).** Every control on a row (`<select>`, Effects/cog/✕ buttons) shares the same explicit height via the `--control-h` variable (defined on `:host` in the orchestrator's `odds-calculator.css`, inherited by every child component since CSS custom properties cascade through the DOM regardless of Angular component boundaries), rather than relying on `align-items: flex-end` alone to align them visually. Before this variable, each control had a slightly different height (padding/border specific to each element type), and even though `flex-end` mathematically aligned their box bottoms pixel-perfectly, the visually different sizes still read as misaligned. A checkbox wrapped in a `<span class="mini-field__control">` (`height: var(--control-h)`, centered) reserves the same "control row" height as the other fields without enlarging the checkbox itself.

**Custom, minimal `<select>` arrow.** A `<select>`'s native arrow reserves a browser/OS-dependent amount of space (often 20px+), which left little room to fit everything on one line once numeric fields became `<select>`s. `.mini-field__input--select` (`shared/mini-field.css`) disables native rendering (`appearance: none`) and draws a tiny arrow via `background-image` (two linear gradients forming a chevron), which lets it control exactly how much space the arrow takes up - and keeps the value genuinely centered rather than offset by a wide arrow.

Two CSS pitfalls hit while implementing "fits on a single line", worth keeping in mind if these rules are ever revisited:
- **`min-width: 0` on `:host`**: the orchestrator is itself a flexbox item of the `.page` container (`app.css`). By default, a flexbox item refuses to shrink below its content's minimum width (`min-width: auto`) - with `nowrap` rows, this minimum content can exceed the screen's width, which would have made **the whole page** overflow (not just scroll within the row) without this `min-width: 0`. The classic flexbox pitfall of "min-width:auto prevents shrinking". Each split-out child component that's a direct flex item of `.panel__body` (`TargetPanel`, `ResultsPanel`) needs the same `min-width: 0` on its own `:host` for the same reason.
- **Global `box-sizing: border-box`** (`src/styles.css`): without it, `width` on inputs doesn't count padding or border, which made width calculations (aiming for "everything fits within 375px") unpredictable - each input rendered several pixels wider than its declared width.

**Measurement pitfall to know about if these widths are tweaked by hand in the browser**: this component runs without zone.js (Angular zoneless), so after modifying a signal from the console (`ng.getComponent(...)`), reading `scrollWidth`/`clientWidth` **immediately** can return pre-render values - the view update is scheduled, not synchronous. Waiting for two `requestAnimationFrame`s before measuring (or simply re-checking after a following screenshot) avoids wrongly concluding that a row "fits" when the DOM hadn't yet caught up with the new state. The same applies to reading `getComputedStyle`/`classList` synchronously right after a script-dispatched `.click()` in the same evaluation: a click handled by Angular's zoneless change detection doesn't flush the DOM update before the *next* task boundary, so a follow-up check needs to happen in a separate script execution (e.g. a separate browser-automation call), not immediately after, or it'll read stale state.

## PWA

- `@angular/service-worker` enabled only outside dev mode (`enabled: !isDevMode()`), `registerWhenStable:30000` registration strategy.
- `ngsw-config.json`: prefetches application files (HTML/CSS/JS/manifest), lazy-caches icons.
- `public/manifest.webmanifest` + `public/icons/*`: multi-resolution icons for home-screen installation (Android and iOS).
- The calculation engine itself makes no network calls: the app works fully offline once loaded/installed. Feedback and analytics (see below) are the only network-dependent things in the app, and neither blocks or degrades any other feature when unavailable.

### Custom install prompt (`PwaInstall`, `src/app/pwa-install.ts`; `PwaInstallBanner`, `src/app/odds-calculator/pwa-install-banner/`)

A root-provided `@Injectable` (the only other one in the app is `OddsEngine` - note neither uses Angular's conventional `Service` class-name suffix, an intentional deviation from the style guide kept consistent across both) wrapping the non-standard `beforeinstallprompt` event, so the app can offer its own install trigger at a moment the visitor chooses, instead of relying purely on whatever install affordance the browser shows on its own (see https://web.dev/learn/pwa/installation-prompt, which this follows closely):

```ts
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  this.deferredPrompt = event as BeforeInstallPromptEvent;
  this.installable.set(true);
});
```

- **`BeforeInstallPromptEvent`** (`prompt(): Promise<void>`, `userChoice: Promise<{ outcome }>`) is hand-declared, not part of TypeScript's DOM lib typings - it's Chromium-only and not a standardized event, so `window.addEventListener('beforeinstallprompt', ...)` falls through TS's generic string-event-name overload (inferring a plain `Event`), and the handler casts it once captured.
- **Eagerly constructed from `App`'s own constructor** (`private readonly pwaInstall = inject(PwaInstall);`, a class field, not read again there) rather than waiting for `PwaInstallBanner` to inject it first - registers the listener as early as possible, the same reasoning `trackPwaInstall()`/`updateAppHeight` already get called directly in that constructor for. `PwaInstallBanner` injects the same root-provided singleton to read `installable()` and call `install()`.
- **`install()` always clears the captured event afterward, accepted or dismissed either way** - a `beforeinstallprompt` event can only be shown once, matching the banner's own disappearance immediately after use.
- **Also listens for `appinstalled`, independently of `install()`**, to reset `installable` back to `false` - covers installing through some route OTHER than this service's own captured event (a browser's separate omnibox install icon isn't gated by the `preventDefault()` above, since accepting it doesn't go through the same event at all).
- **Checks `window.matchMedia('(display-mode: standalone)').matches` once at construction** and skips registering either listener at all if already running as the installed app (nothing to offer, and the event wouldn't fire again for an already-installed PWA anyway). Wrapped in try/catch, defaulting to "not standalone" on failure - this project's Vitest/Node test environment doesn't provide a working `window.matchMedia` (`App`'s eager `inject(PwaInstall)` means `app.spec.ts` constructs this service without ever rendering into a real browser), the same "fail safe instead of crashing" pattern `ChangelogDialog` already uses for its own `localStorage` access.
- **Only Chromium-based browsers (Chrome/Edge, Android and desktop) fire `beforeinstallprompt` at all - Safari (iOS and desktop) never does**, so `installable` simply stays `false` there and the banner never appears - no manual "Add to Home Screen" fallback instructions yet (see the functional documentation's roadmap).

`PwaInstallBanner` is rendered directly in `odds-calculator.html`, between `.panel__header` and `.panel__body` - visible on its own rather than tucked inside `AppMenu`, since `beforeinstallprompt` is a one-shot opportunity worth surfacing directly instead of behind a menu tap. It shows only while `pwaInstall.installable()` is `true` and a local `dismissed` signal is `false`; the **✕** button just sets that signal, a session-only dismissal (no `localStorage`, unlike About/Changelog's "seen it" flags) since re-showing it on the next load costs nothing and there's no repeated pop-up to guard against. The install button itself is styled with `border: 1px solid var(--brass); color: var(--brass)` to match `.panel__eyebrow` (the "ChanceMachine" title text), filling solid on hover.

## Analytics (GoatCounter)

`index.html` loads GoatCounter (`<script data-goatcounter="https://chancemachine.goatcounter.com/count" async src="//gc.zgo.at/count.js">`) - a cookie-free, privacy-friendly page-view counter chosen specifically to avoid the GDPR cookie-consent banner a cookie-based tool like Google Analytics would require for EU visitors. It counts page views automatically on its own; `src/app/analytics.ts` is only for the one CUSTOM event this app tracks on top of that.

- **`trackPwaInstall()`** (called once from `App`'s constructor in `app.ts`, alongside the existing `updateAppHeight` viewport wiring): listens for the standard `appinstalled` event and reports it as a GoatCounter event (`{ path: 'pwa-install', title: 'PWA install', event: true }`). `appinstalled` fires the same way regardless of which install path was taken - the browser's own promotion UI, this app's own install banner (`PwaInstall`/`PwaInstallBanner`, see "Custom install prompt" above), or a platform's manual "Add to Home Screen" - so tracking never needs to hook `beforeinstallprompt` itself, even though `PwaInstall` separately does (for a different reason: building its own prompt trigger, not tracking).
- **`window.goatcounter` is typed via `declare global { interface Window { ... } }`** in `analytics.ts` rather than pulling in a package for it - GoatCounter's script defines this global itself at runtime, there's no npm package to depend on. Every call goes through `window.goatcounter?.count(...)` (optional chaining, not a null check + throw): the script may not have loaded yet, or may be blocked outright by an ad/tracker blocker, and analytics silently doing nothing in that case is correct - it must never be able to break the app.
- **Installed/offline PWA usage isn't visible to GoatCounter at all** beyond the `appinstalled` event itself: any session where the app is opened without a network connection (or where the analytics script is blocked) simply never reaches `chancemachine.goatcounter.com`, the same limitation any client-side web analytics tool has for an installable, offline-capable PWA.
- **`ngsw-config.json`'s `dataGroups` explicitly declares both GoatCounter URLs** (`gc.zgo.at/count.js`, the tracking beacon at `chancemachine.goatcounter.com/count`), with a `"freshness"` strategy (network first, 3s timeout, falls back to cache only if the network genuinely fails). This isn't caching for performance - it's a fix for a real production bug: `@angular/service-worker` intercepts EVERY fetch on a page under its scope, including cross-origin ones, and a request that doesn't match any `assetGroups`/`dataGroups` pattern surfaced as a synthetic `504 Gateway Timeout (from service worker)` in the browser's network tab instead of just passing through to the network - only reproducible against a real deployed build, since the service worker is disabled in dev mode (`enabled: !isDevMode()`), which is why local testing never caught it. Any future third-party/cross-origin script added to `index.html` needs the same treatment, or it'll hit the same failure mode.

## Commands

```bash
npm start        # ng serve — dev server at http://localhost:4200
npm run build     # ng build — production build in dist/
npm test          # ng test — runs Vitest tests via the Angular builder
```

⚠️ Running `npx vitest run` directly (bypassing `ng test`) makes `app.spec.ts` fail (`describe is not defined`) because Angular's test globals aren't injected outside the `@angular/build:unit-test` builder. Always use `npm test` / `ng test` for a reliable run.

## Design decisions worth remembering

- **Targeted rules edition: Warmachine MK4** (user's choice). Base mechanics (2d6, boost, double = critical, Tough) are considered stable and shared across editions; specific named effects are implemented with the most widely accepted wording, but still need to be checked/adjusted against the exact MK4 rulebook — see the functional documentation for the details of these assumptions.
- **Attack order within a sequence: defined by the user**, no automatic optimization (a deliberate product decision, see the functional documentation for the rationale and its limits).
- **Effects: a short, exact list rather than a generic system** — extensible within `AttackEffects`/`RollModifiers` (`attack-model.ts`) and `StatEffect`/`StatEffectType` (`sequence.ts`) as new rules get confirmed, but always a closed, named set of cases rather than an engine for arbitrary expressions.
- **Reroll: a fixed optimal policy, no configurable threshold on the UI side** — rerolling a missed to-hit roll, or a below-average damage roll, mathematically maximizes the expected result; asking the player for a threshold would have added no useful flexibility for the cost of extra interface complexity.
- **Persistent target penalties: a minimal typed state (`DebuffState`) + precomputed reachable states, rather than a dense multi-dimensional table** — see `computeReachableDebuffStates` in `sequence.ts`: the number of penalty dimensions (9) made a dense table combinatorially intractable, while the number of states *actually* reachable for a given sequence stays low in practice. This choice keeps the calculation exact (no approximation on the final result, only a safe over-approximation of the set of states to consider).
- **Target's Focus/Fury spending: optimal via backward induction, not a simple "spend if this hit would otherwise kill me" reflex** — relevant because a point can be worth more spent earlier (to preserve boxes useful for surviving a future hit) than kept "just in case". The calculation stays exact (no heuristic), at the cost of a value table per attack and per reachable penalty state rather than a simple local rule.
- **Critical Shred resolved as a bounded self-referential value problem rather than dynamically growing the sequence**: cloning and inserting an attack into `attacks[]` mid-calculation would make the sequence length itself probabilistic, breaking the `valueTables[k]`/`debuffStatesPerStep[k]` indexing everywhere else. Instead `attackChainValue`/`resolveAttackChainForward` (`sequence.ts`) resolve one attack instance and recurse into another instance of THEMSELVES on a shredding crit, capped at `MAX_SHRED_DEPTH` — see the dedicated section above for the full design, including a real exponential-blowup performance bug (naive per-branch forward-simulation recursion) caught and fixed during development.
