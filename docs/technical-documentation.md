# ChanceMachine — Technical documentation

## Overview

ChanceMachine is an Angular PWA (Progressive Web App) that computes, via exact enumeration (no Monte Carlo), the hit/destroy probabilities against a target in Warmachine/Hordes, for a sequence of attacks (several attackers, several attacks each) chained against a single shared target.

- **Stack**: Angular 21 (standalone components, signals), TypeScript, Vitest.
- **No runtime dependency beyond Angular**: the calculation engine (`src/app/engine/`) is pure TypeScript with no Angular dependency, testable in isolation.
- **PWA**: `@angular/service-worker`, installable on mobile (Android/iOS via "Add to Home Screen"), works offline (no application network calls).

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
   - **Armor Piercing** (`effects.armorPiercing: EffectTrigger`): the ARM used for the damage roll (non-critical and/or critical, depending on `appliesOnNonCritHit`/`appliesOnCritHit`) is replaced by `Math.ceil(target.baseArm / 2)` — `baseArm` is the ARM **before** any persistent penalty (see `sequence.ts`), deliberately distinct from `target.arm` (the effective ARM, penalties included) so the effect properly ignores penalties already in play, as specified.
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
}
```

... combined with `boxes` (boxes remaining), `focusLeft`/`furyLeft` (remaining resource points) and `destroyed` (absorbing state) in the rest of the calculation. For each attack in the sequence, its profile is "folded" into the current state distribution:
- For each living state, the effective DEF/ARM are computed (`effectiveDef`/`baseArm - debuffState.armPenalty`) and whether the attack should auto-hit (melee + `isKnockedDownOrStationary`, or an explicit `forceAutoHit`), the right precomputed profile is chosen, and each outcome's probability is distributed across the new states (reduced boxes and/or new penalties, or destroyed) — after applying, if applicable, the target's **optimal** spend of a Focus/Fury point (see below).
- A Tough roll is retried every time damage (after any Focus/Fury mitigation) would be lethal (no "once per turn" limit in this model — a documented simplification in the code).
- If Tough succeeds, the target is simplified to 1 box remaining and Knocked Down (standard Tough rule behavior), with no fine-grained re-modeling of a partial damage grid — this rule is what couples the "persistent penalties" sub-problem to the "boxes/resources" sub-problem (see below).

**Persistent effects (`StatEffect` / `StatEffectType`)**: each attack carries an optional `statEffects: StatEffect[]` list, each `{ type, trigger, amount? }` (`amount` only for `'armPenalty'`). `applyStatEffectsForOutcome(state, statEffects, isCrit)` applies, for a given outcome (hit or critical hit), every effect whose trigger matches (`'hit'` fires on any hit including a critical one; `'crit'` only on a critical hit) via `applyStatEffect`:
- Every boolean flag (`knockedDown`, `stationary`, `shadowbind`, `blind`, `paralyzed`, `flare`, `weaken`) is **idempotent** — re-triggering it has no further effect, in line with the "an effect only applies once unless stated otherwise" rule.
- `iceCageStacks` is incremented on every trigger (the only flag explicitly stackable among the booleans), `armPenalty` is added to on every trigger (as specified for the generic "-X ARM").
- `isStationary(s)` = `s.stationary || s.iceCageStacks >= 2`; `isKnockedDownOrStationary(s)` = `s.knockedDown || isStationary(s)` — it's this last function that determines auto-hit in melee and the DEF cap of 5, exactly the same logic for Knockdown and Stationary (they're only distinguished because Trash/Shatter need to be able to tell them apart).
- `effectiveDef(baseDef, s)`: first caps DEF at `DEF_FLOOR = 5` if `s.paralyzed || isKnockedDownOrStationary(s)`, then subtracts the cumulative flat penalty (`iceCageStacks × 2 + shadowbind×3 + blind×4 + flare×2 + weaken×2`) — reproduces the "additive, with Paralysis/Knockdown/Stationary as a floor" rule validated with the user.

**Avoiding the combinatorial explosion of a dense 9-dimension penalty table (`computeReachableDebuffStates` + `Map<string, ValueTable>`):**

Naively adding `DebuffState`'s 9 dimensions to the old dense value table `number[boxes][focus][fury]` (already used for Focus/Fury, see below) would have turned it into a ~12-dimension table, whose size would explode combinatorially even for a handful of configured effects. The key to the solution: **`DebuffState` transitions depend neither on the remaining boxes nor on the remaining Focus/Fury points** (the only exception being the Tough → Knockdown coupling, see below), so the set of penalty states *actually reachable* at each step can be precomputed **separately**, once, before the main calculation:

- `computeReachableDebuffStates(attacks, startsKnockedDown, hasTough)` does a light "forward" pass: for each attack, starting from the set of states reachable at the previous step, it computes the states reachable after a non-critical hit, a critical hit, or a miss — and adds, if `hasTough` is true, the "Knocked Down" variant of every candidate state (Tough/Knockdown coupling, see below). The result is deliberately an **over-approximation**: it doesn't matter if a listed state turns out to have zero probability once thresholds/auto-hit are accounted for, as long as no state that's actually reachable is ever missed.
- The main calculation (backward pass + forward pass, see below) then only builds a `(boxes × focus × fury)` value table (`ValueTable`, now 3D instead of 4D) **for each penalty state actually returned by `computeReachableDebuffStates`**, indexed by a compact key (`debuffKey(state)`) in a `Map<string, ValueTable>` — one per step `k` of the sequence (`valueTables: Map<string, ValueTable>[]`). The cost therefore stays proportional to what's *actually reachable* for this specific sequence (in practice a handful of states, bounded by the number of persistent effects actually configured), never to the combinatorial product of the 9 possible dimensions.
- **Tough ↔ Knockdown coupling.** The rest of the penalty transitions are independent of the boxes/Focus/Fury sub-problem, with one exception: the rule "surviving a Tough roll also knocks the target down" makes a `DebuffState` change depend on a dice roll that belongs to the resource sub-problem. `computeReachableDebuffStates` accounts for this by systematically adding the Knocked Down variant of every candidate state whenever `hasTough` is true (whether that roll succeeds or not doesn't matter for this over-approximation pass); `damageBranches` (see below) then computes, at the right moment, which branch (Tough-survival vs. other) actually gets which `DebuffState`.
- **Attack profile cache (`profileCache` / `profileFor`)**: since an attack's effective DEF/ARM/status now depend on the current `DebuffState` (which can vary within a single step `k` if several penalty states are reachable at that point), the profile is no longer cached solely by attack index `k` but by the full key `` `${k}|${usesAutoHit}|${def}|${arm}|${knockedDown}|${isStationary(debuffState)}` `` — the number of distinct contexts actually encountered stays low in practice (bounded by the effects configured on the sequence), so the dice enumeration (the expensive part) is never redone for a context already seen.

**Why it's fast even at ~10 attacks:**

An attack's profile (`buildAttackProfile`, the part that enumerates dice — expensive) does **not** depend on the target's remaining box count. It's therefore cached per distinct context (see `profileCache` above, in practice a small handful per sequence), then reapplied cheaply against every state encountered. A performance test (`engine.spec.ts`) verifies that a sequence of 10 attacks (with or without resource points, with or without persistent effects) runs in under 2 seconds (in practice near-instant).

**Optimal Focus/Fury spending — backward induction (`valueTables`):**

The target may spend, once per attack and after the damage roll, a Focus point (reduces damage by 5) or a Fury point (fully negates damage), never both at once. It's assumed to play **optimally**, meaning: maximizing its probability of surviving the **rest of the sequence**, not just reacting to the current hit. Since the decision is made before knowing future dice rolls, but with a known attack sequence ahead of time, this problem is solved via **backward induction** (dynamic programming) rather than pure forward simulation:

1. **Backward pass**: for each attack `k` (from the last to the first) and for **each penalty state reachable at that step** (`debuffStatesPerStep[k]`, see above), a table `valueTables[k].get(debuffKey(state))[boxes][focusLeft][furyLeft]` is built = probability of surviving attacks `k..n-1` while playing optimally **given that we're in this penalty state**, computed from `valueTables[k+1]` (already known) and attack `k`'s profile for that context. The base case `valueTables[n]` is 1 everywhere, for every penalty state reachable at the end of the sequence (no attacks left = already survived).
2. For each state and each outcome of attack `k`, `bestAction` (in `sequence.ts`) compares the 3 possible choices (spend nothing / spend Focus / spend Fury) and keeps the one that maximizes this future survival value.
3. **Forward pass**: the exact same policy is replayed (via the same already-computed `valueTables`) to produce the actual state distribution and the displayed statistics (`hitChance`, `destroyChanceAtThisStep`, etc.).

**Tie-breaking.** Comparing only "probability of surviving the rest of the sequence" can produce strict ties (e.g. the target is doomed either way, or no future attack depends on the exact remaining box count anymore). A naive comparison (strict `>`) would then systematically resolve these ties toward "spend nothing", which reads as counter-intuitive behavior (the target refuses to defend itself on the current hit even though doing so would cost it nothing). `bestAction` therefore uses a **3-level lexicographic score** (see `outcomeScore`/`isBetterScore`): (1) probability of surviving the rest of the sequence — the real objective; (2) as a tiebreaker, probability of surviving **this specific hit**; (3) as a further tiebreaker, number of boxes preserved. Only when all 3 levels are fully tied does the point go unspent (default behavior: keep the resource).

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

## The UI component (`src/app/odds-calculator/`)

Standalone component (`OddsCalculator`), `ChangeDetectionStrategy.OnPush`, entirely driven by Angular **signals** (automatic recalculation, no "calculate" button).

### Form data model

- **Shared target** (`targetDef`, `targetArm`, `targetBoxes`, `tough`, `toughOn`, `targetFocus`, `targetFury`): simple component-level signals, shown on a single row (`.target-row`).
- **Attack sequence** (`rows: WritableSignal<AttackRow[]>`): each row (`AttackRow`) is an object whose **every field is itself a signal**. No attacker name or editable label: the label shown in the results (`Attack N`) is generated from the row's position. Base fields: `type`, `stat`, `diceCount`, `forceAutoHit`, `pow`, `damageDiceCount`. Effect fields (see "Pop-ups" below for how they're used):
  - General: `jumpTheShark` (boolean) - a single signal for both the attack and damage rolls (see below).
  - To-hit roll: `discardAttackLowest`/`discardAttackHighest` (independent booleans, can both be true), `rerollAttack` (boolean), `sanguineFate` (boolean).
  - Damage roll: `discardDamageLowest`/`discardDamageHighest` (independent booleans), `rerollDamage`, `trash`, `shatter` (booleans).
  - Crit only: `brutalDamage` (boolean).
  - Effects triggerable on a hit/critical hit: `triggerEffects: TriggerEffectRow[]` - see below.

  **`TriggerEffectRow`: a FIXED set rather than a dynamic list.** Unlike an earlier version that managed persistent effects as an extensible `WritableSignal<StatEffectRow[]>` list ("+ Add effect" button, removal by `id`), the current version gives each row a `triggerEffects` array of fixed, known-in-advance size - one `TriggerEffectRow` per key of `TRIGGER_EFFECT_KEYS` (`'armorPiercing' | 'decapitation' | StatEffectType`, 11 entries), created once by `createTriggerEffects()` and never recreated during the row's lifetime:
    ```ts
    interface TriggerEffectRow {
      readonly key: TriggerEffectKey;
      readonly trigger: WritableSignal<EffectTrigger | 'off'>;
      readonly amount: WritableSignal<number>; // only read for 'armPenalty'
    }
    ```
    Since each effect has a fixed slot, there's no more add/remove logic with identifiers needed: the Effects pop-up simply iterates over this array and toggles `trigger` between `'off'`, `'hit'`, and `'crit'`. `toggleTriggerEffect(effect, trigger)` implements the "toggle button" behavior: clicking the button for the already-active trigger switches the effect back to `'off'`; clicking the other trigger switches straight to it (never a need to explicitly turn it off before switching to the other trigger - an effect never has both triggers active at once, in line with the "one effect, one trigger" rule).

  **Why this structure instead of a plain array of JS objects?** With Angular signals, mutating a nested object inside a signal array doesn't trigger recalculation (a signal only detects the replacement of its own value). Two options: (a) clone the whole array on every keystroke, or (b) give each field its own signal, which `computed()` will read individually and can therefore track finely. Option (b) is chosen here: adding/removing an **attack row** replaces the `rows` array (`rows.update(...)`), but editing an effect (fixed) or any other field only touches its own signal — no deep cloning needed, and no mutable internal array left once `triggerEffects` is created.

- **`diceCount` / `damageDiceCount`**: the user directly picks the **total** number of dice rolled (2 by default), not a boost-dice count. `toBoostDice(diceCount)` performs the conversion (`max(0, diceCount - 2)`) when building the `SequencedAttack` object sent to the engine, which reasons in terms of a base 2d6 + boost. `discardModifier(lowest, highest)` translates the pair of booleans into `{ highest?: 1, lowest?: 1 } | undefined` (always at most one die per side — no in-game effect discards more than one per side, but both sides can be active together, see `dice-pool.ts`).
- `sequencedAttacks` (computed, explicitly annotated `computed<SequencedAttack[]>` with a `.map((r, i): SequencedAttack => ({...}))` callback return type): projects `rows()` into `SequencedAttack[]` (the type expected by the engine), generates the `Attack ${i+1}` label from the index, converts `pow` via `resolvePow`, applies `r.jumpTheShark()` to both `modifiers.treatOnesAsSixes` and `damageModifiers.treatOnesAsSixes`, assembles `effects: { brutalDamageDice, armorPiercing, decapitation, trash, shatter }` (via `triggerOf(row, key)` to read a given effect's trigger from `triggerEffects` and turn `'off'`/absent into `undefined`) and `statEffects: StatEffect[]` by filtering `triggerEffects` on `isStatEffectKey(key) && trigger !== 'off'`.

  **TypeScript pitfall avoided: the "excess property" checker doesn't apply to an object literal returned by a `.map()` callback without an explicit type annotation on that callback**, even if the enclosing `computed(...)` carries an explicit generic type. An old renamed/removed field (`criticalEffects`, replaced by `effects`/`statEffects`) had therefore remained silently accepted by the compiler in a `{ ...criticalEffects: {...} }` literal even though `SequencedAttack` no longer had it - the value was simply ignored at runtime. Fixed by explicitly annotating the callback's return type (`(r, i): SequencedAttack => ({...})`), which re-enables strict checking. Worth remembering for any future field added/renamed on `SequencedAttack`.
- `sequence` (computed): calls `engine.computeSequence(...)` — recomputed automatically whenever any signal read inside changes (target or any field, including every `trigger`/`amount` in `triggerEffects`, of any row).
- `effectsSummary(row): string[]`: builds the list of short labels ("Discard highest (atk)", "Trash", "Ice Cage (crit)"...) shown under each attack row, from every active effect field on the row (plain booleans, then a pass over `triggerEffects` skipping entries at `'off'`).
- `resetEffects(row)`: resets every effect field on the row to its default (`forceAutoHit`, each boolean, and `trigger.set('off')`/`amount.set(2)` for every `TriggerEffectRow`) — the "base" fields (type, stat, dice, POW) are deliberately left untouched; only the whole row's "✕" button would reset those.

### Numeric fields as `<select>` rather than `<input type="number">`

Every field with a known range (DEF, ARM, Boxes, Focus, Fury, MAT/RAT/AAT, POW, Dice) is a `<select>` rather than an `<input type="number">`, so that picking a value opens a native picker on mobile instead of the keyboard. The option lists (`DEF_OPTIONS`, `ARM_OPTIONS`, etc., at the top of `odds-calculator.ts`) are generated once via `range(start, end)`.

Tough's success threshold is no longer configurable (removed: `toughOn`) - the rule is always 5+, which is also the default value of `SequenceTarget.toughOn` on the engine side (`target.toughOn ?? 5`), so the component no longer needs to pass it at all.

**Pitfall to know about: `<select>` + `ngModel` always communicates in strings.** A native `<select>` only ever knows `value`s of type `string`; `(ngModelChange)` therefore always emits a string, never a number, even when `[ngModel]` is fed a number. Each binding explicitly converts back: `toNumber(raw)` for regular numeric fields, and `parseDef`/`parsePow` for DEF/POW, which additionally accept a sentinel value (`'KD'`, `'-'`) that must absolutely not be converted to a number.

### Actions

- `addAttack()`: adds a row by cloning the last row's values (`cloneAttackRow`, fresh signals initialized to the same value - no shared reference with the source row), or a default row (`createAttackRow`) if there isn't one yet.
- `removeAttack(id)`: removes a row (at least 1 row always remains).

No button to reorder rows (removed: see functional documentation) - the order is built solely by adding attacks in the intended order.

### Pop-ups (Effects / Details)

Per-attack special effects and the results breakdown (step-by-step, remaining-box distribution) are moved into pop-ups rather than shown permanently, to keep the attack row and results summary compact.

Implementation: the native HTML **`<dialog>`** element (no modal/CDK library) with `@ViewChild` + `.showModal()`:
- `editingRow: WritableSignal<AttackRow | null>` holds the row currently being edited; `openEffects(row)` sets it then opens the pop-up, whose content (`@if (editingRow(); as row)`) binds directly to that row's signals.
- A single "Effects" pop-up is reused for every row (rather than one pop-up per row), and a single "Details" pop-up for the results.
- `closeOnBackdropClick(event, dialog)` closes the pop-up on a click outside its content: for a `<dialog>` opened in modal mode, a click on the `::backdrop` bubbles up a `click` event whose `target` is the `dialog` element itself (not a child) — this property lets us distinguish "click on the backdrop" from "click inside the content" without `stopPropagation()`. The Escape key closes the pop-up natively, with no extra code.

**Content of the Effects pop-up**, organized as "toggle" buttons (`.toggle-btn` / `.toggle-btn--active`, see CSS below) grouped into sections (see the functional documentation for the details of each effect):
- Auto-hit (a single button, at the top, outside any section).
- "General": Jump the Shark (a single button for `row.jumpTheShark`, which drives both the to-hit roll and the damage roll).
- "Attack": Discard lowest, Discard highest, Reroll, Sanguine Fate — each button toggles an independent boolean (`(click)="row.discardAttackLowest.set(!row.discardAttackLowest())"`), so Discard lowest and Discard highest can be active together with no special coordination logic.
- "Damage": Discard lowest, Discard highest, Reroll, Trash, Shatter — same principle on the damage side.
- "On hit": one button per entry of `row.triggerEffects` (`@for (effect of row.triggerEffects; track effect.key)`), active when `effect.trigger() === 'hit'`, `(click)="toggleTriggerEffect(effect, 'hit')"`.
- "On crit": the same loop over `row.triggerEffects`, active when `effect.trigger() === 'crit'`, plus a dedicated button for Brutal Damage (a plain boolean, outside `triggerEffects` since it has no "On hit" variant).
- Amount for `-X ARM`: `@let armPenalty = armPenaltyEffect(row);` then `@if (armPenalty.trigger() !== 'off')` shows a regular `<select>` (not a toggle button - it's an amount, not a boolean) bound to `armPenalty.amount`. `armPenaltyEffect(row)` does a `.find(e => e.key === 'armPenalty')` on the fixed array - always present, hence the non-null `!` in its return type signature.
- "Reset" (`resetEffects(row)`) and "Done" (`closeEffects()`) side by side at the bottom of the pop-up (`.dialog__actions`, `flex: 1 1 0` each).

**Buttons within a given category sit in a `flex-wrap: wrap` container (`.toggle-group`)**, rather than `nowrap` like the Target/Attack rows: unlike those (a fixed, known number of fields), the number of active effects on an attack is open-ended, so the pop-up needs to be able to accommodate any combination by wrapping, without ever widening the `<dialog>` (whose width stays capped at `width: min(90vw, 480px)`, unchanged).

`cloneAttackRow` also clones `row.triggerEffects` (via `cloneTriggerEffects`, which creates a new array of new `TriggerEffectRow`s with fresh signals but the same values) rather than sharing the same objects between the source row and the copy created by "+ Add attack".

**Fixed header/footer, scrolling body (`.dialog__content--framed` + `.dialog__body`).** The Effects pop-up's header (title + close button) and footer (Reset/Done) stay put while only the effect sections in between scroll:
- `.dialog__content--framed` (a modifier applied only to the Effects dialog's `.dialog__content`, so the plain Details dialog is unaffected) turns the container into a `display: flex; flex-direction: column; overflow: hidden;` box; its direct-child header and `.dialog__actions` footer get `flex-shrink: 0`.
- The middle content (every section + the ARM-amount field) is wrapped in a `.dialog__body` div with `flex: 1 1 auto; min-height: 0; overflow-y: auto;`, so it's the only part that scrolls once it overflows the dialog's `max-height: 80vh`.
- Since the first section title now sits inside `.dialog__body` right after the header rather than directly after it, `.dialog__body > .dialog__section-title:first-child` removes that first title's own top border/margin/padding — otherwise it would show its own separator line just below the header's bottom border, reading as a doubled line a few pixels apart.

### App shell: title/Target/Results fixed, only Attack sequence scrolls

The component is structured as a three-zone app shell stacked in a fixed-height container (`height: 100dvh` on `.page`, propagated via `display:flex; flex-direction:column; height:100%` on `:host` then `.panel`, `.panel__body`): `.console`/`.readout` (Target and Results) have `flex-shrink: 0` (natural size, never compressed), and only `.console--attacks` carries `flex: 1 1 auto; min-height: 0`, which makes it occupy all the remaining space between Target and Results. Inside it, it's `.attack-list` (not the whole section) that has `overflow-y: auto` - the "Attack sequence" title and the "+ Add attack" button therefore stay visible above and below the scrolling list.

**`min-height: 0` is essential at every level of this flexbox chain.** Without it, a flex item in a column refuses by default to shrink below its content's height (the same `min-*:auto` pitfall as for the width of compact rows, see below) - which would have prevented `.attack-list` from ever being smaller than its content, and therefore from ever scrolling: the whole page would have grown taller instead.

`100dvh` rather than `100vh` on `.page` (`app.css`): on mobile, the browser's address bar appears/disappears while scrolling, which changes the actually visible height. `100vh` is computed against the maximum height (bar hidden), which can leave the bottom of the screen (here, Results) partially hidden behind the address bar when it's visible; `dvh` (*dynamic* viewport height) tracks the actually visible height at all times. `100vh` is kept as the first-written fallback for browsers that don't support `dvh`.

### Hidden scrollbars

`.target-row`, `.attack-row` (horizontal scrolling) and `.attack-list` (vertical scrolling) hide their scrollbar (`scrollbar-width: none` + `::-webkit-scrollbar { display: none }`) while remaining scrollable (mouse/trackpad/touch) - a visible scrollbar would have ended up right under/next to the fields' digits and visually cluttered them.

### Compact rows, centered and spaced, fitting on a single line (mobile included)

The Target row and each attack row use `flex-wrap: nowrap` rather than `wrap`: the goal is for everything to fit on a single line even on a narrow phone, scrolling horizontally rather than wrapping to a new line if needed. Fields are centered horizontally on the row (`justify-content: safe center` on `.target-row`/`.attack-row`) with generous `gap` between them; the values inside each field are themselves centered (`text-align`/`text-align-last: center` on `.mini-field__input`, `align-items: center` on `.mini-field`).

The `safe` keyword in `justify-content: safe center` avoids a known pitfall: with a plain `center`, if the row ends up overflowing (a very narrow viewport, or more fields added later), the start of the content can become unreachable by scrolling in some browsers - `safe` falls back to `start`-like alignment in that specific case, so horizontal scrolling (`overflow-x: auto`) can always reveal everything.

**Vertical alignment of controls (`--control-h`).** Every control on a row (`<select>`, Effects/✕ buttons, the Tough checkbox) shares the same explicit height via the `--control-h` variable (defined on `:host`), rather than relying on `align-items: flex-end` alone to align them visually. Before this variable, each control had a slightly different height (padding/border specific to each element type), and even though `flex-end` mathematically aligned their box bottoms pixel-perfectly, the visually different sizes still read as misaligned. The Tough checkbox is additionally wrapped in a `<span class="mini-field__control">` (`height: var(--control-h)`, centered): this reserves the same "control row" height as the other fields without enlarging the checkbox itself (which stays at its usual native size).

**Custom, minimal `<select>` arrow.** A `<select>`'s native arrow reserves a browser/OS-dependent amount of space (often 20px+), which left little room to fit everything on one line once numeric fields became `<select>`s. `.mini-field__input--select` disables native rendering (`appearance: none`) and draws a tiny arrow via `background-image` (two linear gradients forming a chevron), which lets it control exactly how much space the arrow takes up - and keeps the value genuinely centered rather than offset by a wide arrow.

Two CSS pitfalls hit while implementing "fits on a single line", worth keeping in mind if these rules are ever revisited:
- **`min-width: 0` on `:host`**: this component is itself a flexbox item of the `.page` container (`app.css`). By default, a flexbox item refuses to shrink below its content's minimum width (`min-width: auto`) - with `nowrap` rows, this minimum content can exceed the screen's width, which would have made **the whole page** overflow (not just scroll within the row) without this `min-width: 0`. The classic flexbox pitfall of "min-width:auto prevents shrinking".
- **Global `box-sizing: border-box`** (`src/styles.css`): without it, `width` on inputs doesn't count padding or border, which made width calculations (aiming for "everything fits within 375px") unpredictable - each input rendered several pixels wider than its declared width.

**Measurement pitfall to know about if these widths are tweaked by hand in the browser**: this component runs without zone.js (Angular zoneless), so after modifying a signal from the console (`ng.getComponent(...)`), reading `scrollWidth`/`clientWidth` **immediately** can return pre-render values - the view update is scheduled, not synchronous. Waiting for two `requestAnimationFrame`s before measuring (or simply re-checking after a following screenshot) avoids wrongly concluding that a row "fits" when the DOM hadn't yet caught up with the new state.

## PWA

- `@angular/service-worker` enabled only outside dev mode (`enabled: !isDevMode()`), `registerWhenStable:30000` registration strategy.
- `ngsw-config.json`: prefetches application files (HTML/CSS/JS/manifest), lazy-caches icons.
- `public/manifest.webmanifest` + `public/icons/*`: multi-resolution icons for home-screen installation (Android and iOS).
- No application network calls: the app works fully offline once loaded/installed.

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
- **Shred deliberately not implemented**: would require dynamically cloning and inserting an attack into the sequence during the calculation itself (a Shred attack can itself re-trigger a new Shred), which changes the nature of the problem (the sequence is no longer fixed ahead of time) — postponed to a future iteration rather than rushed into the current architecture.
