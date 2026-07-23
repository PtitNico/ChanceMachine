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

**Compact layout.** Since Target and Results are fixed and Attack sequence is the only part that scrolls, every pixel spent on Target/Results chrome is a pixel not available to show attacker cards — this matters most on short mobile screens. The Target section's title sits on the same line as its DEF/ARM/Boxes row rather than above it, and the standalone "Attack sequence"/"Results" section titles have been dropped entirely — the attacker cards and the two result gauges are self-explanatory enough on their own without them. Results' "Show details" pop-up (see below) opens from a small icon next to the Average damage gauge, rather than a full-width button, for the same reason.

### Install banner

A banner between the header and the Target section, with a bordered "Install app" button (in the same brass/orange as the "ChanceMachine" title) and a **✕** button on its right. It only appears once the browser has told the app it's installable (Chrome/Edge on Android and desktop; Safari never does, on either iOS or desktop, so the banner never appears there). "Install app" triggers the browser's own install prompt directly, at a moment of your choosing, instead of relying purely on whatever install affordance the browser shows on its own; the banner disappears immediately after, whether the prompt was accepted or dismissed — a browser only ever offers it once per visit. The **✕** dismisses the banner for the rest of that visit without installing (it reappears on the next page load, as long as the browser still considers the app installable).

### Menu

A **☰ (hamburger)** icon button in the top-right corner of the header opens a small dropdown:
- **Reset**: clears **everything** — the target's DEF/ARM/Boxes and its whole profile (Focus/Fury, Special rules, spell bonuses), plus the attack sequence, which collapses back down to a single default attack row. Unlike the Reset buttons inside the Effects/Target profile pop-ups (which only ever touch what's inside that specific pop-up), this is the one "start completely over" action in the app. It takes effect immediately, with no confirmation step.
- **About**: a short pop-up explaining what the app does and how it computes its numbers. It also opens **automatically, once**, the very first time the app is loaded on a device/browser — a new visitor gets that explanation without having to find the menu first. It never opens itself again afterwards, whether or not that first pop-up was actually read (closing it instantly still counts as "seen"), and opening it manually from the menu doesn't affect this in either direction.
- **Changelog**: a pop-up listing recent changes, grouped by date (newest first). It also opens **automatically**, once, whenever new entries have been added since the last time a visitor saw it — but never on that very first-ever visit, since About already covers "what is this app" there, and a full history of "what's new" would just be noise for someone who's never used any earlier version. A returning visitor who's genuinely missed something new sees exactly that, once, the next time they open the app.
- **Feedback**: a pop-up with a small form (a Feedback/Bug report toggle, a message, and an optional email) to send feedback or report a bug directly from the app, without leaving it or knowing where to file an issue. Submissions go to a spreadsheet via a small Google Apps Script backend (see the technical documentation) — there's no visible confirmation that the *script* processed it successfully (only that the message was sent), a limitation of that kind of lightweight backend.
- **☕ Support me**: a link to the developer's Ko-fi page, opening in a new tab.

The dropdown closes itself after picking an action, on pressing Escape, or on clicking anywhere outside it.

### 1. Target

A single row of fields, shared across the whole attack sequence:
- **DEF**: `KD` (the target is Knocked Down from the start of the sequence — **melee** attacks then automatically hit for the whole sequence, but **ranged** and **magic** attacks still roll normally against a DEF of 5), then 5 to 25.
- **ARM**: 1 to 35.
- **Boxes** (remaining damage capacity): 1 to 99.
- A **⚙ (cog)** icon button that opens the **Target profile** pop-up (see below). Once the pop-up is closed, a compact summary of every active item is shown in small text **below the row** (e.g. `Focus 2`, `Tough Steady`, `Shield +2 ARM`, `Arcane Shield (+3 ARM) [Dispellable]`), the same "tags under the row" presentation already used for each attack's active effects.

The Target profile pop-up groups everything that isn't DEF/ARM/Boxes directly, organized into toggle-button sections identical in style to the Effects pop-up (see "Attack sequence" below):
- **Resources**: a **Focus / Fury** toggle (a model has one or the other, never both) plus a single point count, 0 to 15 (see "Focus and Fury" below).
- **Knowledge of the Damned**: two independent counters, 0 to 10 each — **Offensive** (rerolls shared across every attacker in the sequence) and **Defensive** (rerolls the target itself can call on, against any attacker's roll) — see "Knowledge of the Damned" below.
- **Shield Guard / Scapegoat**: two independent counters — **Shield Guards** (0 to 10, blocks one ranged attack each) and **Scapegoats** (0 to 4, blocks one melee attack each) — see "Shield Guards and Scapegoats" below.
- **Special rules**: **Tough** / **Tough Steady** (mutually exclusive — activating one deactivates the other; see "Modeled rules" for the difference between them), **Shield** (a flat ARM bonus, amount 1 to 10, appears once Shield is active), **Unyielding** (+2 ARM against melee attacks only), **Carapace** (+4 ARM against ranged attacks only), **Rapid Healing** (heals d3 boxes after a damaging, non-destroying hit — see "Target capabilities" below).
- **Spells**: a repeatable list for spell-granted stat bonuses or capabilities that aren't worth naming individually (there are far too many to enumerate) — see "Spell bonuses" below.
- **Reset**: clears every item in the pop-up at once (DEF/ARM/Boxes, which live outside the pop-up, are untouched).

### 2. Attack sequence

An ordered list of **attacker cards**, each with a drag handle (⋮⋮) on its left edge — press and
drag it to reorder attackers relative to each other. Each card represents one attacker (a model, a
caster, an individual figure in a unit) and holds the MAT/RAT/AAT its own attacks share, plus its
own ordered list of attacks:
- A **name**: click/tap directly on it to rename in place — no separate button or pop-up — with
  "Attacker N" shown as dimmed placeholder text until it's renamed, and a small pencil glyph after
  it as the only hint that it's editable. Its **MAT / RAT / AAT** (0 to 20 each) sit inline next to
  the name, but only the ones its own attacks actually use — a melee-only attacker shows just MAT,
  a caster with a melee attack and a spell shows MAT and AAT, and so on. A blue **⚙ (cog)** icon
  button opens the **Attacker's special rules** pop-up (currently just Puppet Master — see below);
  a red trash icon button removes the whole attacker (disabled while it's the only one — at least
  one attacker always remains).
- One **attack sub-card** per attack this attacker makes, each with its own drag handle to reorder
  attacks within that attacker (an attack can't be dragged into a different attacker), showing:
  - The attack **type** as a dropdown of emoji — 🗡️ melee, 🏹 ranged, 🪄 arcane — which decides
    whether this attack uses the attacker's MAT, RAT, or AAT, and whether a **Knockdown** triggered
    earlier in the sequence benefits it (see below).
  - **ROF** (ranged attacks only — `1`/`d3`/`2d3`, see below), **Dice** (to-hit dice, 1 to 6; 2 by
    default — the player directly picks this number to represent a boost, rather than entering a
    separate boost-dice count), **POW** (`-` for an attack that deals no damage at all, e.g. one
    whose sole purpose is a critical effect like Knockdown — a critical hit is still possible since
    the to-hit roll still happens — otherwise 0 to 30), and **Dice** again (damage dice, 1 to 6) —
    all edited directly on the card, spaced evenly across the row.
  - A **compact summary** of its active effects (e.g. `Discard highest (atk)`, `Trash`, `Ice Cage
    (crit)`) — so the whole sequence stays scannable without reopening anything.
  - A blue **⚙ (cog)** icon button that opens the **Effects** pop-up (the same toggle-button
    breakdown described below) — Type/ROF/Dice/POW live on the card itself, not in this pop-up — and
    a red trash icon button that removes just this attack (disabled while it's the only attack on
    this attacker — remove the whole attacker instead).
  - A **"+ Add attack"** button inside the card adds a new attack to *this* attacker, copying the
    values of its own last attack (type, ROF, dice, POW, every effect — MAT/RAT/AAT don't need
    copying, they already live on the attacker) — since chaining similar attacks is the most common
    case, the player only needs to adjust the few fields that change.

**ROF** (Rate of Fire, ranged attacks only): `1` (default), `d3`, or `2d3` — how many independent
shots this attack actually fires. The shot count is rolled once, before any of this attack's own
dice, exactly like on the tabletop: with `d3` or `2d3`, this one attack fires that many separate
to-hit/damage rolls in a row against the target (each seeing whatever debuffs earlier shots in the
SAME volley already inflicted), rather than just one.

**Puppet Master** (toggled in the attacker's special rules pop-up): grants that attacker a single
reroll, shared across every roll it makes over the whole sequence — used on the **first attack roll
that would otherwise miss**. If every one of its remaining attacks is already guaranteed to auto-hit
(or it's already down to its very last attack), the reroll targets a **below-average damage roll**
instead. It's entirely possible for the reroll to go **unused** — if none of its attack rolls ever
miss and its final damage roll is already fine, there was simply never a good moment to spend it.
This is deliberately **not** the mathematically best possible use of the reroll: an optimal spend
would let the app claim a higher chance to destroy the target than a real player could actually
achieve, since they don't know in advance which roll will turn out to be the best one to save it
for. Puppet Master instead follows the same simple, mechanical rule a player would apply at the
table, watching the sequence unfold roll by roll.

Each effect in the Effects pop-up is a **rounded "toggle" button**: grey/inactive by default, it fills with color (brass background) once activated — a single click turns it on or off, with no checkbox or dropdown involved. Buttons are grouped by category, each category shown on its own row that **wraps as soon as needed** rather than widening the pop-up (so the number of active effects never affects the app's width):
- **Auto-hit**: a standalone button at the top of the pop-up — forces the to-hit roll to automatically succeed, regardless of DEF.
- **General**: Jump the Shark — applies **to both** the to-hit roll and the damage roll (a single button for both, rather than a separate setting per roll) —, Blessed (ignores every Stat-type spell bonus on the target — see "Spell bonuses" below).
- **Attack** (to-hit roll modifiers): Discard lowest, Discard highest — discards the lowest and/or the highest die before summing; **both can be active at the same time** on the same roll —, Reroll (optional reroll if the roll would miss), Sanguine Fate.
- **Damage** (damage roll modifiers): Discard lowest, Discard highest (same rule: stackable), Reroll (optional reroll if the roll is below average), Trash, Shatter, Chain Weapon (ignores the target's Shield ARM bonus specifically — nothing else).
- **On hit** / **On crit**: every effect that can trigger on a hit and/or on a critical hit (Armor Piercing, Decapitation, Knockdown, Stationary, Ice Cage, Shadowbind, Blind, Paralysis, Flare, Weaken, "-X ARM", Dispel, Grievous Wounds) appears in both categories, once each. Activating an effect's button under "On hit" triggers it on any hit (crits included); activating it under "On crit" restricts it to critical hits only; the two buttons for a given effect are mutually exclusive (activating one deactivates the other). Brutal Damage and Critical Shred only appear under "On crit" (neither can ever trigger on a plain hit). When **"-X ARM"** is active (in either category), an amount selector (1 to 10) appears at the bottom of the pop-up.
- **Reset**: a button at the bottom of the pop-up that deactivates every effect on this attack at once (Auto-hit included), so the player can start over from a "clean" attack instead of unchecking effects one by one — Type/ROF/Dice/POW live on the card itself and aren't touched by this.

The **"+ Add attacker"** button below the list adds a new attacker with one default attack.

**Card order is resolution order.** The app doesn't automatically search for the best possible order: attacks resolve top attacker to bottom, top attack to bottom within each attacker — this is a deliberate choice (see "Product choices" below) — it's up to the player to define the order they intend to play, just as they would at the table, using the drag handles to arrange attacker and attack cards accordingly.

### 3. Results

By default, only two figures are shown:
- **Chance to destroy**: total probability of destroying the target over the whole sequence.
- **Average damage**: expected total damage dealt over the whole sequence (unconditional — a destroyed target's exact overkill isn't tracked, so a destroyed outcome counts as exactly `boxesInitial` damage, same convention as the "N+" bucket in the damage distribution below).

A small **query_stats** icon next to the Average damage gauge (rather than a full-width button or a section title, to keep this fixed section as compact as possible — see "Compact layout" above) opens a pop-up with the full breakdown:
- **Step by step**: for each attack in the sequence, in order: *Hit* (chance to hit), *Crit* (chance of a critical hit, a double on the to-hit roll), *Avg damage* (average damage dealt by this attack's damage roll, dice + POW − ARM). All three are conditional on the target still being alive at that point in the sequence, and don't account for any Focus/Fury mitigation (they're properties of the attack itself, not of the sequence's outcome).
- **Total damage distribution**: a histogram of the distribution of total damage dealt over the whole sequence (0 up to `boxesInitial - 1`), with every outcome that destroys the target grouped into a single aggregated bucket labelled `"N+"` (e.g. `"5+"` for a 5-box target) — since a destroyed target's exact overkill isn't tracked beyond "it reached or exceeded its box count".

A large sequence with several resource counters (Focus/Fury, Knowledge of the Damned) pushed high at once can take a few seconds to calculate. If a calculation is still running after a brief moment, a **Calculating...** message with a spinning gear appears over the two gauges — the last-known numbers stay visible underneath, dimmed, rather than disappearing, and a rough progress estimate is shown alongside the message when one's available. The rest of the app (editing attacks, opening pop-ups) stays fully usable while this runs in the background.

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
- **Critical Shred**: on a critical hit, this attack fires again immediately — same stats, same effects — against the target's current state (after the triggering hit's own damage, Tough, Focus/Fury, and healing have all resolved), and that extra attack can itself critically hit and fire yet another one, recursively. There's no rules limit on how many times this can chain — only the dice decide — though the app caps the calculation at a very deep bound internally, leaving a probability far too small to ever show up in the results unaccounted for (see the technical documentation). In the **Step by step** breakdown (see "Results" below), **Avg damage** for a Critical Shred attack is the total expected damage across the **whole chain**, not just the triggering roll — since that's what actually happens at that point in the sequence — but **Hit**/**Crit** stay the chance of that **first** roll specifically: once an unknown number of rolls might occur, "chance to hit" no longer has a single well-defined meaning to aggregate.

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

### Shield Guards and Scapegoats (target resource points)

Two more counters, in the Target profile pop-up: **Shield Guards** (0 to 10) and **Scapegoats** (0 to 4). Each one fully blocks a single attack outright — both its damage and any persistent effect it would have inflicted (Knockdown, Ice Cage, etc.) — as if it had simply missed. A Shield Guard only blocks a **ranged** attack; a Scapegoat only blocks a **melee** attack; neither blocks a magic attack. On a Rate of Fire attack, one block covers exactly one shot in the volley, not the whole burst.

Like Focus/Fury, these are spent **optimally**, with the same whole-sequence lookahead — at most one per attack (or per shot), whichever resource (if any) helps most. Unlike Focus/Fury, a block is a genuine miss for every purpose except the displayed Hit/Crit chance: it does not trigger Rapid Healing (the attack never landed), and it does not let a Critical Shred chain continue, even though the roll that got blocked still counts toward that attack's Hit%/Crit% — see "Product choices" below.

### Knowledge of the Damned (target resource points)

Two more resource counters live in the Target profile pop-up, both 0 to 10, working very differently from each other despite sharing a name:

**Offensive Knowledge of the Damned** grants every attacker in the sequence a SHARED pool of forced rerolls — unlike Puppet Master, which is one token per attacker, this is one pool for the whole army. It follows the same kind of fixed, mechanical rule Puppet Master uses (see above), generalized to however many charges are available: reroll the first missed attack roll encountered, in sequence order, spending a charge each time; reroll a below-average damage roll only once there's a safe surplus — enough charges left afterward to cover every remaining roll, across every attacker, that could still miss. With exactly 1 charge, this behaves identically to a single Puppet Master token. Charges can go unused, exactly like Puppet Master's own token can.

**Defensive Knowledge of the Damned** grants the TARGET a pool of forced rerolls it can use against any attacker's attack or damage roll. Unlike Offensive Knowledge of the Damned (and Puppet Master), this one IS spent optimally — the same "look ahead through the whole sequence" assumption already used for Focus/Fury — since it's a resource the target itself controls, not something a real attacking player would need to guess about in advance. On each roll it's available for, the app picks whichever helps most: forcing a reroll of the attack roll (hoping for a miss instead of a hit), forcing a reroll of the damage roll (hoping for a below-average result), or not spending a charge at all.

Both counters are **cumulative** with each other, with Puppet Master, and with a row's own configured Reroll toggle — a single roll can be rerolled once by an attacker-side rule (the row's own Reroll, Puppet Master, or Offensive Knowledge of the Damned) AND separately by Defensive Knowledge of the Damned, since one is the attacker's resource and the other is the target's.

## Assumptions to verify (MK4 edition)

Some rules points were implemented using the most commonly accepted formulation across Warmachine/Hordes editions, for lack of absolute certainty about the exact MK4 wording (a recent edition, 2023):
- The fact that **only melee** benefits from auto-hit against a Knocked Down target (no numeric bonus/penalty for ranged/magic against a downed target).
- Tough's behavior (surviving at 1 box + Knocked Down).

**To be checked against the MK4 rulebook** and corrected if needed — these are modeling assumptions, not rules copied from the book.

## Not yet implemented

- **Automatic optimization of attack order**: a product decision — the order remains manually defined by the user (see "Product choices").
- Unit handling (several identical models in a single group attack) — not handled, the engine reasons model by model.

## Product choices (validated with the user)

- **Rules edition: MK4** — rather than MK2/MK3, in line with the edition currently played by the community.
- **Attack order defined by the user**, rather than automatic optimization: simpler to use, matches how a player actually plans their turn (they already know the order they intend to play their attacks in), and avoids the combinatorial explosion of an exhaustive search over ordering as the number of attacks grows.
- **Effects: a short, exact list rather than a generic, fully configurable system** — priority given to the correctness of implemented rules over broad but approximate coverage. The list has grown (roll modifiers, per-attack effects, persistent target effects, target capabilities) but remains a named, closed list, not an engine for arbitrary effects.
- **Spell bonuses are the one deliberate exception, by necessity**: since Warmachine/Hordes has far too many spells to name individually, the Target profile's Spells section is a small generic system (name + Stat-or-Rule + Dispellable tag) rather than a named list — the only place in the app where the player enters a raw stat bonus instead of picking a named, pre-validated effect. Reusing the same "Special rules" toggles for the Rule case keeps attack-type conditions (Unyielding/Carapace) and Tough/Tough Steady exclusivity correct for free, rather than reimplementing them a second time for the spell path. Blessed and Dispel then read the Dispellable/Stat-or-Rule tags directly, so this generic system pays off across both the Spells section itself and the two attack effects that interact with it.
- **Reroll with no configurable threshold**: rather than asking the player to pick a reroll threshold, the app always applies the optimal policy (reroll a missed to-hit roll, or a below-average damage roll) — avoiding an extra configuration field for a mathematically equivalent or better result.
- **Puppet Master deliberately does NOT spend its reroll optimally**, unlike the target's own Focus/Fury: an omniscient-optimal spend would let the app claim a higher chance to destroy the target than a real player could actually achieve, since a real player doesn't know in advance which future roll would have been the best one to save the reroll for. Instead it follows the same simple, mechanical, no-lookahead rule described above (first missed attack roll, or a below-average damage roll once nothing's left to miss) — the reroll can end up unused, exactly as it could for a real player.
- **Offensive Knowledge of the Damned reuses Puppet Master's own non-optimal reasoning, generalized to N pooled charges**: the same "a real player can't know in advance which future roll is best to save a reroll for" argument applies just as much to a shared pool as to a single token, so it follows the same kind of fixed rule rather than an optimal spend. **Defensive** Knowledge of the Damned, being the target's own resource rather than the attacker's, gets the SAME optimal-spend treatment Focus/Fury already has — for the same reason Puppet Master/Offensive Knowledge of the Damned don't: it isn't the app pretending to know more than a real player would, since the target's own controller genuinely can see the whole board.
- **Additive DEF penalties, with Knocked Down/Stationary/Paralysis as a floor**: the named penalties (Ice Cage, Shadowbind, Blind, Flare, Weaken) all stack with each other; Knocked Down/Stationary/Paralysis cap DEF at 5 first rather than stacking like the others, reflecting their in-game wording ("DEF reduced to 5" rather than "−X DEF").
- **Persistent effects don't stack unless stated otherwise**: a given named effect can only apply once to a target (Ice Cage and the generic "-X ARM" being the only explicitly stackable exceptions), staying faithful to the "unless specified" wording provided by the user.
- **Tough vs. Knocked Down is now correctly modeled**: an earlier version of the app let Tough succeed even while the target was already Knocked Down, which isn't how the tabletop rule works. Fixing this was necessary for Tough Steady (a capability that's specifically defined as "Tough, but immune to that negation") to mean anything at all.
- **Armor Piercing now correctly halves only the printed base ARM**: an earlier version had it ignore every ARM buff and debuff outright (always resolving against the raw printed stat). The corrected rule halves just the base value; every buff (Shield, spell bonuses, Unyielding/Carapace) and debuff (the generic "-X ARM" penalty) currently in play still applies on top, exactly as it would on a normal attack.
- **Rapid Healing implemented as a genuine new probability branch**, rather than postponed: after any non-destroying hit that deals damage, the target's box count now branches three ways (d3 heal), on top of the existing boxes/debuffs/Focus-Fury branching - comparable in scope to the persistent-debuffs work, but no longer deferred. Grievous Wounds (which also removes Tough/Tough Steady) shipped alongside it as the effect that turns it off.
- **Feedback goes to a Google Sheet via Apps Script, not a real backend**: the app has no server of its own (it's a static PWA), so adding a proper feedback API wasn't worth the operational cost for a low-traffic hobby project. A Google Apps Script Web App bound to a spreadsheet is a few dozen lines, free to run, and needs nothing hosted - the tradeoff is that the client can't reliably confirm the script actually processed a submission (see "Menu" above), only that it was sent.
- **Critical Shred resolved as a bounded self-referential value problem, not deferred**: it's the one effect that changes the NUMBER of rolls made at a given position in the sequence, rather than DEF/ARM/boxes/debuffs for a fixed set of rolls, which is why it stayed "postponed to a future iteration" for a long time. Since each further chained attack requires another crit, its probability shrinks geometrically - capping the recursion at a generous depth (see the technical documentation) leaves an error far below anything the app's results could ever visibly show, the same kind of tradeoff already used for Tough's "no once-per-turn limit".
- **No separate version number: the changelog's own newest date IS the version**, compared directly against whatever date a visitor last saw. Simpler than introducing a parallel semver scheme nothing else in the app needs, and it reuses the exact same "auto-open once, remember with a localStorage flag" idea already validated by About - just with "once" meaning "once per new set of entries" instead of "once ever".
- **Shield Guards/Scapegoats are a true block, not mitigation like Focus/Fury**: Focus/Fury only ever soften or negate the DAMAGE of a hit that still technically landed — Rapid Healing still triggers off a Fury-negated hit, and a Fury-negated crit still lets Critical Shred chain. A Shield Guard/Scapegoat block instead reverts the hit as if it had missed outright, including any persistent effect it would have inflicted, so neither of those consequences fires. The one thing it deliberately does NOT touch is the displayed Hit%/Crit% for that attack — those reflect the roll that was actually made, not what the target chose to do about it afterward, matching how Focus/Fury already leave Hit%/Crit% alone too.
- **The calculation runs in a background Web Worker, not on the main thread**: with Focus/Fury and both Knowledge of the Damned counters all pushed high at once, a calculation can take several seconds - and since a plain synchronous calculation would freeze the whole page for that whole time (no repaint, no animation, nothing), it now runs in the background instead, so the page stays fully responsive and the "Calculating..." message can actually appear and animate. The progress percentage shown alongside it is a rough estimate (how many of the sequence's attacks have finished resolving) rather than an exact figure - the very first attack often does the bulk of the total work internally, so the percentage can jump unevenly (e.g. straight to 80%, then crawl for the rest) rather than climbing smoothly. This was accepted as a reasonable tradeoff over showing no progress indication at all.

## Roadmap

- Icons and final PWA manifest configuration.
- Verification of the display on smartphones (in progress).
- Manual "Add to Home Screen" instructions for Safari (iOS and desktop) - the only browser that never fires the `beforeinstallprompt` event the install banner relies on, so it currently just never appears there instead of offering any alternative.

### Larger features under consideration

Rough sizing (S/M/L/XL), for prioritization purposes only - not a commitment on scope or order:

- **Damage grids for warjacks** (location-based systems - Movement, arms, etc. - each with their own boxes, crippled independently, plus a "chance to cripple system X" stat) — **XL**. The biggest item here by a wide margin: today's model is one target with one box pool: this needs a genuinely new sub-model (hit-location resolution, per-system boxes and crippled state, grid degradation) that current results (single "chance to destroy") don't map onto directly.
- **Attacker Focus/Fury with optimal buy/boost strategy** (spending points on boosted rolls or bought extra attacks, played optimally across the whole sequence) — **L/XL**. The target's defensive Focus/Fury (already implemented) only ever chooses "spend this one point now or don't" - the attacker's version has a much bigger decision space (boost which roll, of which attack, or buy a whole extra attack instead), which likely means a new backward-induction dimension layered on top of the target's existing one, with real risk of state-space blowup to manage carefully (same kind of caution Critical Shred's recursion needed).
- **Custom reroll strategy** (reroll on a miss, reroll if not a critical, etc., instead of always the mathematically optimal policy) — **S/M**. `rerollPoolOnceIf` (`dice-pool.ts`) already takes an arbitrary "is this roll bad?" predicate - today's fixed policy is just the ONE predicate the app happens to expose. Mostly UI work (a way to pick the condition) plus a handful of new named predicates; low architectural risk since the underlying mechanism already generalizes.
