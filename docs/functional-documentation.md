# ChanceMachine — Functional documentation

## Purpose

ChanceMachine is a probability calculator for the **Warmachine / Hordes** tabletop miniatures games. It answers the question a player asks while planning their turn: *"if I chain these attacks in this order, what's my chance of destroying this target?"*

It's the successor to **OddsMachine**, an Android app that's no longer available/working on modern smartphones. ChanceMachine covers the same need as a PWA (Progressive Web App), installable on Android **and** iOS, without going through a store.

Targeted rules edition: **Warmachine MK4**.

## Who is it for?

The international Warmachine/Hordes player community — which is why the interface is in English.

## What the app calculates

Given:
- a **single target** (DEF, ARM, remaining damage boxes, plus an optional profile of resource points and capabilities — Focus/Fury, Tough, Shield, Unyielding, Carapace, spell bonuses),
- an **ordered attack sequence** (one or more attackers, each with one or more attacks),

the app calculates, via **exact enumeration** of dice rolls (no approximation or random simulation):
- the chance to hit for each attack in the sequence,
- the chance to destroy the target at *each step* of the sequence,
- the cumulative chance to destroy the target after N attacks,
- the expected number of boxes remaining if the target survives,
- the full distribution of boxes remaining in case of survival.

Results recompute **instantly** on every field change, with no "Calculate" button.

## Main screen

The screen is split into three vertically stacked zones: **Target** at the top, **Attack sequence** in the middle, **Results** at the bottom. The title, Target, and Results are **fixed on screen** (Results stays pinned to the bottom); only the Attack sequence part scrolls vertically if the sequence has many attacks, without moving the rest of the screen.

All numeric fields are **dropdown lists** (`<select>`) rather than free-text inputs — on mobile, this opens a native picker instead of the keyboard, which is noticeably faster for choosing a value within a range known in advance. Values are centered within each field, with generous spacing between fields. The Target row and each attack row fit on **a single line, including on mobile**; if a screen is genuinely too narrow to show everything, the row scrolls horizontally instead of wrapping to a new line — with no visible scrollbar (so it doesn't crowd the numbers), while finger/trackpad scrolling remains possible.

**Compact layout.** Since Target and Results are fixed and Attack sequence is the only part that scrolls, every pixel spent on Target/Results chrome is a pixel not available to show attack rows — this matters most on short mobile screens. Section titles (Target/Attack sequence/Results) are kept small, and Results uses a small **"+"** icon next to its title instead of a full-width button (see below) to leave as much room as possible for the attack list.

### 1. Target

A single row of fields, shared across the whole attack sequence:
- **DEF**: `KD` (the target is Knocked Down from the start of the sequence — **melee** attacks then automatically hit for the whole sequence, but **ranged** and **magic** attacks still roll normally against a DEF of 5), then 5 to 25.
- **ARM**: 1 to 35.
- **Boxes** (remaining damage capacity): 1 to 99.
- A **⚙ (cog)** icon button that opens the **Target profile** pop-up (see below). Once the pop-up is closed, a compact summary of every active item is shown in small text **below the row** (e.g. `Focus 2`, `Tough Steady`, `Shield +2 ARM`, `Arcane Shield (+3 ARM) [Dispellable]`), the same "tags under the row" presentation already used for each attack's active effects.

The Target profile pop-up groups everything that isn't DEF/ARM/Boxes directly, organized into toggle-button sections identical in style to the Effects pop-up (see "Attack sequence" below):
- **Resources**: a **Focus / Fury** toggle (a model has one or the other, never both) plus a single point count, 0 to 15 (see "Focus and Fury" below).
- **Special rules**: **Tough** / **Tough Steady** (mutually exclusive — activating one deactivates the other; see "Modeled rules" for the difference between them), **Shield** (a flat ARM bonus, amount 1 to 10, appears once Shield is active), **Unyielding** (+2 ARM against melee attacks only), **Carapace** (+4 ARM against ranged attacks only).
- **Spells**: a repeatable list for spell-granted stat bonuses or capabilities that aren't worth naming individually (there are far too many to enumerate) — see "Spell bonuses" below.
- **Reset**: clears every item in the pop-up at once (DEF/ARM/Boxes, which live outside the pop-up, are untouched).

### 2. Attack sequence

An ordered list of "attack" rows. Each row represents **one attack** and carries:
- An order number, and a **✕** button (remove — at least one attack always remains). There's no button to reorder rows: the order is built by adding attacks in the intended order.
- **Type**: `melee` / `ranged` / `arcane` — determines whether a **Knockdown** triggered earlier in the sequence benefits this attack (see below), and changes the next field's label.
- **MAT / RAT / AAT** (the label adapts to the chosen type): 0 to 20.
- **Dice**: total number of dice rolled to hit, 1 to 6 (2 by default; the player directly picks this number to represent a boost, rather than entering a separate boost-dice count).
- **POW**: `-` (the attack deals no damage at all — useful for an attack whose sole purpose is a critical effect like Knockdown; a critical hit is still possible since the to-hit roll still happens), then 0 to 30.
- **Dice** (second occurrence): total number of dice rolled for damage, 1 to 6.
- **Effects**: a button that opens a pop-up grouping this attack's special effects — a dot appears on the button as soon as at least one effect is active. Once the pop-up is closed, a **compact summary** of this attack's active effects is shown in small text **below the row** (e.g. `Discard highest (atk)`, `Trash`, `Ice Cage (crit)`), so the whole sequence stays scannable without reopening each pop-up.

  Each effect in the pop-up is a **rounded "toggle" button**: grey/inactive by default, it fills with color (brass background) once activated — a single click turns it on or off, with no checkbox or dropdown involved. Buttons are grouped by category, each category shown on its own row that **wraps as soon as needed** rather than widening the pop-up (so the number of active effects never affects the app's width):
  - **Auto-hit**: a standalone button at the top of the pop-up — forces the to-hit roll to automatically succeed, regardless of DEF.
  - **General**: Jump the Shark — applies **to both** the to-hit roll and the damage roll (a single button for both, rather than a separate setting per roll) —, Blessed (ignores every Stat-type spell bonus on the target — see "Spell bonuses" below).
  - **Attack** (to-hit roll modifiers): Discard lowest, Discard highest — discards the lowest and/or the highest die before summing; **both can be active at the same time** on the same roll —, Reroll (optional reroll if the roll would miss), Sanguine Fate.
  - **Damage** (damage roll modifiers): Discard lowest, Discard highest (same rule: stackable), Reroll (optional reroll if the roll is below average), Trash, Shatter, Chain Weapon (ignores the target's Shield ARM bonus specifically — nothing else).
  - **On hit** / **On crit**: every effect that can trigger on a hit and/or on a critical hit (Armor Piercing, Decapitation, Knockdown, Stationary, Ice Cage, Shadowbind, Blind, Paralysis, Flare, Weaken, "-X ARM", Dispel) appears in both categories, once each. Activating an effect's button under "On hit" triggers it on any hit (crits included); activating it under "On crit" restricts it to critical hits only; the two buttons for a given effect are mutually exclusive (activating one deactivates the other). Brutal Damage only appears under "On crit" (it can never trigger on a plain hit). When **"-X ARM"** is active (in either category), an amount selector (1 to 10) appears at the bottom of the pop-up.
  - **Reset**: a button at the bottom of the pop-up that deactivates every effect on this attack at once (Auto-hit included), so the player can start over from a "clean" row instead of unchecking effects one by one.

The **"+ Add attack"** button adds a new attack at the bottom of the list, **copying the values of the last attack in the list** (type, stats, dice, every effect) — since chaining similar attacks is the most common case, the player only needs to adjust the few fields that change instead of re-entering everything.

**Row order is resolution order.** The app doesn't automatically search for the best possible order: this is a deliberate choice (see "Product choices" below) — it's up to the player to define the order they intend to play, just as they would at the table.

### 3. Results

By default, only two figures are shown:
- **Chance to destroy**: total probability of destroying the target over the whole sequence.
- **Average damage**: expected total damage dealt over the whole sequence (unconditional — a destroyed target's exact overkill isn't tracked, so a destroyed outcome counts as exactly `boxesInitial` damage, same convention as the "N+" bucket in the damage distribution below).

A small **"+"** icon next to the "Results" title (rather than a full-width button, to keep this fixed section as compact as possible — see "Compact layout" below) opens a pop-up with the full breakdown:
- **Step by step**: for each attack in the sequence, in order: *Hit* (chance to hit), *Crit* (chance of a critical hit, a double on the to-hit roll), *Avg damage* (average damage dealt by this attack's damage roll, dice + POW − ARM). All three are conditional on the target still being alive at that point in the sequence, and don't account for any Focus/Fury mitigation (they're properties of the attack itself, not of the sequence's outcome).
- **Total damage distribution**: a histogram of the distribution of total damage dealt over the whole sequence (0 up to `boxesInitial - 1`), with every outcome that destroys the target grouped into a single aggregated bucket labelled `"N+"` (e.g. `"5+"` for a 5-box target) — since a destroyed target's exact overkill isn't tracked beyond "it reached or exceeded its box count".

## Modeled rules

- To-hit roll: 2d6 + any boosts ≥ (DEF − MAT/RAT).
- A double on the to-hit roll = critical hit.
- **A to-hit roll where every die shows 1 is always a miss**, regardless of MAT/RAT/AAT and DEF.
- **A to-hit roll where every die shows 6 is always a hit** (and therefore also a critical hit, since a roll where every die matches necessarily contains a double), regardless of MAT/RAT/AAT and DEF — unless only one die is rolled, in which case a lone 6 gets no special bonus.
- Damage roll: 2d6 + any boosts + POW − ARM (minimum 0).
- **Tough**: whenever damage would be lethal, a Tough roll is attempted; on success, the target survives with 1 box remaining and becomes Knocked Down (standard Tough rule behavior) instead of being destroyed. **A Knocked Down or Stationary target cannot attempt a plain Tough roll at all** (the real tabletop rule — a downed model doesn't get to try) and is simply destroyed; **Tough Steady** is a separate capability that behaves exactly like Tough but is immune to that negation, so it always gets its roll regardless of the target's current state. **Grievous Wounds** removes both outright (see "Supported effects" below) — unlike the Knocked Down negation, it applies to Tough Steady too.
- **Auto-hit** (`Effects > Auto-hit`, or a Knocked Down/Stationary target facing a melee attack, or `DEF: KD`): no to-hit roll is made at all, so an auto-hit can never produce a critical hit (no to-hit dice rolled = no double possible).
- **DEF: KD** (target starts the sequence Knocked Down) behaves exactly like a Knockdown triggered mid-sequence (see below), simply active from the first attack rather than triggered by one: only **melee** attacks auto-hit (for the whole sequence, from the start); **ranged** and **magic** attacks roll normally against a DEF of 5.

### Supported effects

**Roll modifiers** (apply to the roll itself, before the outcome is determined):
- **Discard lowest** / **Discard highest** (attack and/or damage, independently): discards the lowest and/or the highest die before summing. **Both can be active at the same time** on the same roll (e.g. a 4-dice roll that keeps only the two middle dice).
- **Reroll** (attack and/or damage): a single optional reroll. On the to-hit roll, the app systematically rerolls a roll that **would miss** — this is always mathematically at least as good as keeping the original roll. On the damage roll, it rerolls a roll that's **below average** (2d6 → typically below 7) following the same principle. The player has nothing to configure: the toggle simply activates "the optimal reroll available" for that roll.
- **Jump the Shark**: every die showing a 1 counts as a 6 instead — applies **to both** the to-hit roll and the damage roll (a single setting for both, since the in-game effect covers every die the attack rolls).
- **Sanguine Fate**: an extra die is rolled alongside the to-hit roll — it never counts toward the sum, but can create a double (and therefore a critical hit) with any other die in the roll.

**Effects scoped to a single attack** (don't persist on the target):
- **Brutal Damage**: on a critical hit, adds an extra die to the damage roll.
- **Armor Piercing** (triggered on a hit or on a critical hit, your choice): halves the target's **printed base** ARM, rounded up, for this attack's damage roll only — every buff and debuff currently in play (Shield, spell bonuses, Unyielding/Carapace, "-X ARM" penalties below) still applies on top of that halved value, exactly as it would without Armor Piercing.
- **Decapitation** (triggered on a hit or on a critical hit, your choice): doubles the damage dealt by this attack.
- **Trash**: an extra damage die if the target is **currently** Knocked Down at the time of this attack.
- **Shatter**: an extra damage die if the target is **currently** Stationary at the time of this attack.
- **Blessed**: this attack ignores every **Stat**-type spell bonus on the target (both DEF and ARM) — Shield, Unyielding, Carapace, and any **Rule**-type spell grant are all unaffected, since those aren't Stat-type bonuses.
- **Chain Weapon**: this attack ignores the target's **Shield** ARM bonus specifically — nothing else (not spell stat bonuses, not Unyielding/Carapace).

**Effects that persist on the target** (triggered on a hit or on a critical hit, chosen per effect; remain active for **the rest of the sequence** once triggered — unless stated otherwise):
- **Knockdown**: the target becomes *Knocked Down*. Only later **melee** attacks benefit from it (auto-hit); ranged and magic attacks still roll normally, but against a DEF capped at 5 (see "Stationary" below for the details of that cap).
- **Stationary**: behaves **exactly like Knockdown** for the to-hit roll (auto-hit in melee, DEF capped at 5 for ranged/magic) — the two are tracked separately only because Trash (Knockdown) and Shatter (Stationary) need to be able to distinguish them.
- **Ice Cage**: −2 DEF, **stackable** (each trigger adds to the previous ones). From 2 stacks onward, the target also becomes Stationary (so it auto-hits in melee), on top of the DEF penalty which keeps stacking.
- **Shadowbind**: −3 DEF.
- **Blind**: −4 DEF.
- **Paralysis**: caps the target's DEF at 5 (like Knocked Down/Stationary), and then stacks with the other active DEF penalties (Ice Cage, Shadowbind, Blind, Flare, Weaken) exactly as if it were a Knockdown.
- **Flare**: −2 DEF.
- **Weaken**: −2 DEF.
- **-X ARM** (generic, amount configurable from 1 to 10): reduces the target's ARM for the rest of the sequence, stackable with other instances of this effect. Applied on top of Armor Piercing's halved base ARM too, same as every other ARM buff/debuff.
- **Dispel**: removes every spell bonus/rule currently flagged **Dispellable** (see "Spell bonuses" below) from the target, for the rest of the sequence. A **Rule**-type spell entry is always Dispellable, so any Tough/Unyielding it grants goes away too; a **Stat**-type entry only goes away if its own Dispellable checkbox is still checked. Innate capabilities toggled directly in "Special rules" are never affected — only spell-granted ones can be dispelled. Like the other persistent effects, once triggered it applies to every later attack in the sequence, never the attack that triggered it.
- **Grievous Wounds**: the target loses **Tough** and **Tough Steady** entirely (both, if either is active) and can no longer benefit from **Rapid Healing**, for the rest of the sequence. Unlike the Knocked Down negation (which only ever affected plain Tough, never Tough Steady), Grievous Wounds removes both.

All the DEF penalties listed above are **additive** with each other (Ice Cage, Shadowbind, Blind, Flare, Weaken all stack), except Knocked Down/Stationary/Paralysis, which **cap DEF at 5 first** before the other penalties are added on top (so DEF can potentially drop below 5 if several effects stack). Each named effect (other than Ice Cage and "-X ARM", which are explicitly stackable) can only apply once on a given target, even if triggered by several different attacks in the sequence — a second occurrence then has no further effect.

**Effect reserved for a future iteration: Shred** (an extra free attack on a critical hit, with the same profile as the attack that triggered it) — deliberately not implemented yet (see "Not yet implemented").

### Target capabilities

Set once in the Target profile pop-up (see "Target" above), these apply for the **whole sequence** rather than being triggered by a specific attack:
- **Tough** / **Tough Steady**: see "Modeled rules" above for how they differ.
- **Shield**: a flat ARM bonus (amount configurable from 1 to 10), applied against every attack regardless of type — unless that attack has **Chain Weapon**, which ignores Shield specifically.
- **Unyielding**: +2 ARM, but only against **melee** attacks.
- **Carapace**: +4 ARM, but only against **ranged** attacks.
- **Rapid Healing**: after any hit that deals damage to the target **without destroying it**, the target immediately heals **d3 boxes** (1, 2, or 3, equally likely), never going above its starting box count. What counts as "damaged" is the hit's damage **before** any Focus/Fury point is spent on it — a model that spends a resource point to blunt or fully negate a hit was still hit, so Rapid Healing still triggers off that original wound even if the mitigated damage that actually reached its boxes was 0. Only a genuine **miss** (or a hit ARM reduces to 0 outright) heals nothing. Turned off for the rest of the sequence by **Grievous Wounds** (see "Supported effects" above), including on the very hit that inflicts the wound.

None of these stack with themselves (each is a simple on/off toggle), and Shield/Unyielding/Carapace/Tough Steady/Rapid Healing are all cumulative with each other and with the persistent DEF/ARM effects listed above (they're independent bonuses, not mutually exclusive with anything except Tough/Tough Steady with each other).

### Spell bonuses

Warmachine/Hordes has far too many spells to list individually, and each one either grants a flat stat bonus or a named capability for the rest of the game. Rather than trying to enumerate them, the Target profile pop-up's **Spells** section is a repeatable list: for each spell currently active on the target, add an entry with:
- A **name** (free text, purely for the player's own reference — it doesn't affect the calculation).
- A **type**, either:
  - **Stat**: a single **DEF or ARM bonus** (0 to 10), applied unconditionally (regardless of attack type), added on top of everything else.
  - **Rule**: **Tough** or **Unyielding** — granted to the target exactly as if it had been toggled directly in the "Special rules" section above, with the same conditions (Unyielding still only applies against melee attacks). Only these two are offered here (Tough Steady, Shield, and Carapace are almost always innate model rules rather than spell-granted in practice, so they're left off this list to keep it short). Only one rule per entry; a spell granting several needs one entry each.
- A **Dispellable** checkbox, for spells that are Upkeep/animus effects (as opposed to a one-shot effect that still lasts the rest of the fight) — an attack's **Dispel** effect removes every entry still flagged Dispellable, for the rest of the sequence. A **Rule**-type entry is always Dispellable and the checkbox is locked on: a rule that's never meant to be dispelled should just be toggled directly in "Special rules" instead of modeled as a spell.

As many spell entries as needed can be added at once (a caster can have several buffs active on the same model simultaneously) — each is removed individually with its own **✕** button.

### Focus and Fury (target resource points)

If the target has **Focus** and/or **Fury** points (fields in the Target section), it can spend **at most one per attack**, **after that attack's damage roll**:
- **1 Focus point** reduces this attack's damage by 5 (floored at 0).
- **1 Fury point** completely negates this attack's damage (in the game: transferred to a warbeast — simplified here to "damage ignored").

These points are assumed to be **spent optimally** by the target. "Optimally" means: the app computes, by working back through the whole attack sequence from the end (backward induction), the spending policy that maximizes the target's probability of surviving the entire sequence — not just a reaction of "spend if this hit would otherwise be fatal". In practice, this lets the app recognize that mitigating a non-fatal hit now (to preserve boxes useful later) can sometimes be worth more than saving the point for a future hit.

In the event of a strict tie between several choices with respect to this objective (e.g. the target is doomed either way), the app prioritizes, in order: surviving the current hit, then preserving the most boxes remaining — rather than "wasting" a point arbitrarily with no benefit, or conversely refusing to use one when it costs nothing.

## Assumptions to verify (MK4 edition)

Some rules points were implemented using the most commonly accepted formulation across Warmachine/Hordes editions, for lack of absolute certainty about the exact MK4 wording (a recent edition, 2023):
- The fact that **only melee** benefits from auto-hit against a Knocked Down target (no numeric bonus/penalty for ranged/magic against a downed target).
- Tough's behavior (surviving at 1 box + Knocked Down).

**To be checked against the MK4 rulebook** and corrected if needed — these are modeling assumptions, not rules copied from the book.

## Not yet implemented

- **Shred** (an extra free attack on a critical hit, same profile as the attack that triggered it, itself able to re-trigger a new Shred): postponed to a future iteration.
- **Automatic optimization of attack order**: a product decision — the order remains manually defined by the user (see "Product choices").
- Unit handling (several identical models in a single group attack) — not handled, the engine reasons model by model.

## Product choices (validated with the user)

- **Rules edition: MK4** — rather than MK2/MK3, in line with the edition currently played by the community.
- **Attack order defined by the user**, rather than automatic optimization: simpler to use, matches how a player actually plans their turn (they already know the order they intend to play their attacks in), and avoids the combinatorial explosion of an exhaustive search over ordering as the number of attacks grows.
- **Effects: a short, exact list rather than a generic, fully configurable system** — priority given to the correctness of implemented rules over broad but approximate coverage. The list has grown (roll modifiers, per-attack effects, persistent target effects, target capabilities) but remains a named, closed list, not an engine for arbitrary effects.
- **Spell bonuses are the one deliberate exception, by necessity**: since Warmachine/Hordes has far too many spells to name individually, the Target profile's Spells section is a small generic system (name + Stat-or-Rule + Dispellable tag) rather than a named list — the only place in the app where the player enters a raw stat bonus instead of picking a named, pre-validated effect. Reusing the same "Special rules" toggles for the Rule case keeps attack-type conditions (Unyielding/Carapace) and Tough/Tough Steady exclusivity correct for free, rather than reimplementing them a second time for the spell path. Blessed and Dispel then read the Dispellable/Stat-or-Rule tags directly, so this generic system pays off across both the Spells section itself and the two attack effects that interact with it.
- **Reroll with no configurable threshold**: rather than asking the player to pick a reroll threshold, the app always applies the optimal policy (reroll a missed to-hit roll, or a below-average damage roll) — avoiding an extra configuration field for a mathematically equivalent or better result.
- **Additive DEF penalties, with Knocked Down/Stationary/Paralysis as a floor**: the named penalties (Ice Cage, Shadowbind, Blind, Flare, Weaken) all stack with each other; Knocked Down/Stationary/Paralysis cap DEF at 5 first rather than stacking like the others, reflecting their in-game wording ("DEF reduced to 5" rather than "−X DEF").
- **Persistent effects don't stack unless stated otherwise**: a given named effect can only apply once to a target (Ice Cage and the generic "-X ARM" being the only explicitly stackable exceptions), staying faithful to the "unless specified" wording provided by the user.
- **Tough vs. Knocked Down is now correctly modeled**: an earlier version of the app let Tough succeed even while the target was already Knocked Down, which isn't how the tabletop rule works. Fixing this was necessary for Tough Steady (a capability that's specifically defined as "Tough, but immune to that negation") to mean anything at all.
- **Armor Piercing now correctly halves only the printed base ARM**: an earlier version had it ignore every ARM buff and debuff outright (always resolving against the raw printed stat). The corrected rule halves just the base value; every buff (Shield, spell bonuses, Unyielding/Carapace) and debuff (the generic "-X ARM" penalty) currently in play still applies on top, exactly as it would on a normal attack.
- **Rapid Healing implemented as a genuine new probability branch**, rather than postponed: after any non-destroying hit that deals damage, the target's box count now branches three ways (d3 heal), on top of the existing boxes/debuffs/Focus-Fury branching - comparable in scope to the persistent-debuffs work, but no longer deferred. Grievous Wounds (which also removes Tough/Tough Steady) shipped alongside it as the effect that turns it off.

## Roadmap

- Implement Shred (recursive free attack on a critical hit).
- Icons and final PWA manifest configuration.
- Verification of the display on smartphones (in progress).
