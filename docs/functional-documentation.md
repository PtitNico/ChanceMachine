# ChanceMachine — Functional documentation

## Purpose

ChanceMachine is a probability calculator for the **Warmachine / Hordes** tabletop miniatures games. It answers the question a player asks while planning their turn: *"if I chain these attacks in this order, what's my chance of destroying this target?"*

It's the successor to **OddsMachine**, an Android app that's no longer available/working on modern smartphones. ChanceMachine covers the same need as a PWA (Progressive Web App), installable on Android **and** iOS, without going through a store.

Targeted rules edition: **Warmachine MK4**.

## Who is it for?

The international Warmachine/Hordes player community — which is why the interface is in English.

## What the app calculates

Given:
- **one or more targets**, each independent (DEF, ARM, remaining damage boxes, plus an optional profile of resource points and capabilities — Focus/Fury, Tough, Shield, Unyielding, Carapace, spell bonuses),
- an **ordered attack sequence** (one or more attackers, each with one or more attacks),

the app calculates, via **exact enumeration** of dice rolls (no approximation or random simulation), for EACH target in turn (attacks go against the first target until it's destroyed, then spill onto the next):
- the chance to hit for each attack in the sequence,
- the chance to destroy that target at *each step* of the sequence,
- the cumulative chance to destroy that target after N attacks,
- the expected number of boxes remaining if that target survives,
- the full distribution of boxes remaining in case of survival.

Results recompute **instantly** on every field change, with no "Calculate" button.

## Main screen

The screen is split into three vertically stacked zones: **Target** at the top, **Attack sequence** in the middle, **Results** at the bottom. The title, Target, and Results are **fixed on screen** (Results stays pinned to the bottom); only the Attack sequence part scrolls vertically if the sequence has many attacks, without moving the rest of the screen.

All numeric fields are **dropdown lists** (`<select>`) rather than free-text inputs — on mobile, this opens a native picker instead of the keyboard, which is noticeably faster for choosing a value within a range known in advance. Values are centered within each field, with generous spacing between fields. The Target row and each weapon row fit on **a single line, including on mobile**; if a screen is genuinely too narrow to show everything, the row scrolls horizontally instead of wrapping to a new line — with no visible scrollbar (so it doesn't crowd the numbers), while finger/trackpad scrolling remains possible.

**Compact layout.** Results always stays a single fixed-size row, and Target and Attack sequence share whatever vertical space is left below it — but not identically: Attack sequence is the primary workspace, so it's the one section that grows to fill genuinely spare room (and keeps a guaranteed minimum share if space gets tight), while Target only ever takes exactly the room its own cards need, never more — so "+ Add target" always sits right under the last target card instead of floating with empty space beneath it. Either list scrolls internally on its own once there isn't room to show every card at once, which matters most on short mobile screens or with several targets configured — the app itself never scrolls as a whole. None of the three sections ("Target(s)", "Attack sequence", "Results") shows a standalone section title anymore — each target card's own name already sits on the same line as its DEF/ARM/Boxes row, and the attacker cards/result gauges are self-explanatory enough without a heading above them. Results' "Show details" pop-up (see below) opens from a small icon next to the Average damage gauge (or, with more than one target, next to the "Chance to destroy all targets" line), rather than a full-width button, for the same reason — and with more than one target, per-target results live only in that pop-up's own tabs rather than a list that grows with target count (see "Results" below).

### Install banner

A banner between the header and the Target section, with a bordered "Install app" button (in the same brass/orange as the "ChanceMachine" title) and a **✕** button on its right. It only appears once the browser has told the app it's installable (Chrome/Edge on Android and desktop; Safari never does, on either iOS or desktop, so the banner never appears there). "Install app" triggers the browser's own install prompt directly, at a moment of your choosing, instead of relying purely on whatever install affordance the browser shows on its own; the banner disappears immediately after, whether the prompt was accepted or dismissed — a browser only ever offers it once per visit. The **✕** dismisses the banner for the rest of that visit without installing (it reappears on the next page load, as long as the browser still considers the app installable).

### Menu

A **☰ (hamburger)** icon button in the top-right corner of the header opens a small dropdown:
- **Reset**: clears **everything** — every target collapses back down to a single default target (DEF/ARM/Boxes and its whole profile reset), and the attack sequence collapses back down to a single default weapon row. Unlike the Reset buttons inside the Effects/Target profile pop-ups (which only ever touch what's inside that specific pop-up), this is the one "start completely over" action in the app. It takes effect immediately, with no confirmation step.
- **About**: a short pop-up explaining what the app does and how it computes its numbers. It also opens **automatically, once**, the very first time the app is loaded on a device/browser — a new visitor gets that explanation without having to find the menu first. It never opens itself again afterwards, whether or not that first pop-up was actually read (closing it instantly still counts as "seen"), and opening it manually from the menu doesn't affect this in either direction.
- **Changelog**: a pop-up listing recent changes, grouped by date (newest first). It also opens **automatically**, once, whenever new entries have been added since the last time a visitor saw it — but never on that very first-ever visit, since About already covers "what is this app" there, and a full history of "what's new" would just be noise for someone who's never used any earlier version. A returning visitor who's genuinely missed something new sees exactly that, once, the next time they open the app.
- **Feedback**: a pop-up with a small form (a Feedback/Bug report toggle, a message, and an optional email) to send feedback or report a bug directly from the app, without leaving it or knowing where to file an issue. Submissions go to a spreadsheet via a small Google Apps Script backend (see the technical documentation) — there's no visible confirmation that the *script* processed it successfully (only that the message was sent), a limitation of that kind of lightweight backend.
- **☕ Support me**: a link to the developer's Ko-fi page, opening in a new tab.

The dropdown closes itself after picking an action, on pressing Escape, or on clicking anywhere outside it.

### 1. Targets

One or more **target cards**, each an independent model with its own DEF/ARM/Boxes and its own full
profile (Focus/Fury, Special rules, resource counters, spell bonuses) — nothing about one target's
own state (debuffs, resources, capabilities) ever affects another's. **Attacks resolve against the
first target in the list until it's destroyed, then spill onto the next, and so on** — the SAME
order-matters principle "Card order is resolution order" (see "Attack sequence" below) already
applies to, just extended across targets too, including **mid-volley**: if one shot of a multi-shot
weapon (`# Atks`/ROF) destroys the current target, that SAME weapon's remaining shots redirect to
the next target immediately, exactly like the tabletop rule, rather than waiting for the next weapon
in the sequence.

Each card shows:
- A **name**: click/tap directly on it to rename in place, same as an attacker's own name — shown as
  dimmed placeholder text (**"Target"** while it's the only one, **"Target N"** by position once
  there's more than one) until explicitly renamed.
- **DEF**: `KD` (this target is Knocked Down from the start of the sequence — **melee** attacks then
  automatically hit it for the whole sequence, but **ranged** and **magic** attacks still roll
  normally against a DEF of 5), then 5 to 25.
- **ARM**: 1 to 35.
- **Boxes** (remaining damage capacity): 1 to 99.
- A **⚙ (cog)** icon button that opens THIS target's own **Target profile** pop-up (see below). Once
  closed, a compact summary of every active item is shown in small text below the card, same as
  before.
- A trash icon button that removes this target (disabled while it's the only one — at least one
  target always remains).

A **"+ Add target"** button below the list adds a new target, copying the LAST target's current
profile (DEF/ARM/Boxes and everything in its Target profile pop-up) — the same "copy the previous
one" convenience the attack sequence's own "+ Add weapon"/"+ Add attacker" buttons already offer.

**Weapon range**: once there's more than one target, each weapon's own Effects pop-up gains an
**In range of** section at the very top — one toggle button per target, all on by default —
narrowing which targets that specific weapon can hit at all. A weapon that isn't in range of the
currently-engaged target keeps checking further down the target list for one it CAN reach, rather
than sitting the round out — a weapon scoped to target 2 only fires at target 2 regardless of what
happens to target 1, exactly as if it had never been aimed at target 1 in the first place. With only
one target, this section is hidden entirely — there's nothing to narrow. A weapon must stay in range
of at least one target — its last remaining toggle can't be switched off, so it's never possible to
leave a weapon with nothing to fire at. Once there's more than one target, every weapon's own row in
the attack sequence shows an **"In range of: Target 1, Target 2..."** line underneath its fields —
listing every target it can reach, even when that's all of them — so a player never has to open the
Effects pop-up just to check.

The Target profile pop-up groups everything that isn't DEF/ARM/Boxes directly, organized into toggle-button sections identical in style to the Effects pop-up (see "Attack sequence" below):
- **Resources**: independent **Focus** and **Fury** toggles, each 0 to 15 — picking a value on one automatically clears the other (a model has one or the other, never both) — see "Focus and Fury" below.
- **Knowledge of the Damned**: two independent counters, 0 to 10 each — **Offensive** (rerolls shared across every attacker in the sequence) and **Defensive** (rerolls the target itself can call on, against any attacker's roll) — see "Knowledge of the Damned" below.
- **Shield Guard / Scapegoat**: two independent counters — **Shield Guards** (0 to 10, blocks one ranged attack each) and **Scapegoats** (0 to 4, blocks one melee attack each) — see "Shield Guards and Scapegoats" below.
- **Special rules**: **Tough** / **Tough Steady** (mutually exclusive — activating one deactivates the other; see "Modeled rules" for the difference between them), **Shield** (a flat ARM bonus toggle, 0 to 4), **Unyielding** (+2 ARM against melee attacks only), **Carapace** (+4 ARM against ranged attacks only), **Rapid Healing** (heals d3 boxes after a damaging, non-destroying hit — see "Target capabilities" below).
- **Dispellable special rules**: **Unyielding** and **Tough** toggles that grant the SAME rule as above, but removable by an attack's **Dispel** effect (an upkeep spell, unlike the permanent toggles in "Special rules") — each is mutually exclusive with its permanent counterpart in "Special rules" (a model is Unyielding, or Tough, one way at a time, never both at once).
- **Upkeep spells / Animi** and **Spells**: two more sections, each with a **DEF** and an **ARM** toggle (0 to 6 each) for spell-granted stat bonuses that aren't worth naming individually (there are far too many to enumerate) — see "Custom effects" below.
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
  button opens the **Attacker's special rules** pop-up (Puppet Master and Focus — see below); a red
  trash icon button removes the whole attacker (disabled while it's the only one — at least one
  attacker always remains).
- One **weapon sub-card** per weapon this attacker carries, each with its own drag handle to reorder
  weapons within that attacker (a weapon can't be dragged into a different attacker), showing:
  - **# Atks** — how many times this weapon fires, guaranteed. For melee/arcane weapons, a single
    dropdown, 1 to 10 (default 1). For **ranged** weapons, two dropdowns share the "# Atks" label:
    the guaranteed count (0 to 10, default 1 — 0 is only meaningful for ranged, letting a weapon
    rely entirely on ROF for a purely random shot count) and **ROF** itself (`-`/`d3`/`2d3`, see
    below) side by side — switching a weapon away from Ranged with the count at 0 bumps it back to
    1, since 0 isn't a valid guaranteed count for melee/arcane.
  - The attack **type** as a dropdown of emoji — 🗡️ melee, 🏹 ranged, 🪄 arcane — which decides
    whether this weapon uses the attacker's MAT, RAT, or AAT, and whether a **Knockdown** triggered
    earlier in the sequence benefits it (see below).
  - **Dice** (to-hit dice, 1 to 6; 2 by default — the player directly picks this number to represent
    a boost, rather than entering a separate boost-dice count), **POW** (`-` for a weapon that deals
    no damage at all, e.g. one whose sole purpose is a critical effect like Knockdown — a critical
    hit is still possible since the to-hit roll still happens — otherwise 0 to 30), and **Dice**
    again (damage dice, 1 to 6) — all edited directly on the card, spaced evenly across the row.
  - A **compact summary** of its active effects (e.g. `Discard highest (atk)`, `Trash`, `Ice Cage
    (crit)`) — so the whole sequence stays scannable without reopening anything.
  - A blue **⚙ (cog)** icon button that opens the **Effects** pop-up (the same toggle-button
    breakdown described below) — # Atks/Type/ROF/Dice/POW live on the card itself, not in this
    pop-up — and a red trash icon button that removes just this weapon (disabled while it's the
    only weapon on this attacker — remove the whole attacker instead).
  - A **"+ Add weapon"** button inside the card adds a new weapon to *this* attacker, copying the
    values of its own last weapon (# Atks, type, ROF, dice, POW, every effect — MAT/RAT/AAT don't
    need copying, they already live on the attacker) — since chaining similar weapons is the most
    common case, the player only needs to adjust the few fields that change.

**ROF** (Rate of Fire, ranged weapons only): `-` (default, no extra shots), `d3`, or `2d3` — how
many EXTRA independent shots this weapon fires on top of its **# Atks** guaranteed base (total
shots = # Atks + ROF's roll). The extra shot count is rolled once, before any of this weapon's own
dice, exactly like on the tabletop: with `d3` or `2d3`, this one weapon fires that many extra
separate to-hit/damage rolls in a row against the target (each seeing whatever debuffs earlier
shots in the SAME volley already inflicted), on top of the guaranteed # Atks shots.

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

**Focus** (0 to 10, set via the same attacker's special rules pop-up as Puppet Master): a per-attacker
resource, spent on any roll made by any of that attacker's own attacks, over the **whole sequence**
(not reset when attacks spill onto a new target — the attacker keeps whatever Focus it hasn't spent
yet). Each point can be spent, once per roll, to:
- **Boost an attack or damage roll**: add one extra die to that roll. A roll already boosted for
  free by the **Boosted** effect (see below) can't be boosted again this way — a roll can only ever
  be boosted once.
- **Buy an extra attack**: fired with whichever of the attacker's own melee weapons — or ranged
  weapons with **Reload** active (see below) — the app determines is best, **after** every one of
  that attacker's own configured attacks have fired (bought attacks stack — a second point can buy
  a further attack after the first bought one, and so on, for as long as Focus remains).

Unlike Puppet Master, Focus is spent **optimally** — the same whole-sequence lookahead already used
for the target's own Focus/Fury (see below): the app computes, ahead of time, the spending policy
that gives this attacker the best chance of destroying the target, rather than a fixed rule. A short
**"Focus strategy"** summary is shown per (Focus-enabled attacker, target) pair in the Details
pop-up, describing in plain language what the computed policy actually does against THAT target,
naming the exact weapon each action applies to (e.g. "boost Ranged's attack rolls until the target
is Knocked Down, then boost Ranged's damage rolls", or "buy extra attacks with Melee1 whenever
Focus is available") — generated directly from the policy the app actually computed, not a
hand-written description of what Focus can do in general. An attacker that spends differently
against different targets (e.g. boosting a single ranged shot at a fragile solo, then buying extra
melee attacks against a tankier second target) gets one line per target rather than one sentence
blurring both together, since Focus is spent target by target even though the pool itself is shared
across the whole sequence.

Each effect in the Effects pop-up is a **rounded "toggle" button**: grey/inactive by default, it fills with color (brass background) once activated — a single click turns it on or off, with no checkbox or dropdown involved. Buttons are grouped by category, each category shown on its own row that **wraps as soon as needed** rather than widening the pop-up (so the number of active effects never affects the app's width):
- **Auto-hit**: a standalone button at the top of the pop-up — forces the to-hit roll to automatically succeed, regardless of DEF.
- **General**: Jump the Shark — applies **to both** the to-hit roll and the damage roll (a single button for both, rather than a separate setting per roll) —, Blessed (ignores the target's spell-granted DEF/ARM bonuses — see "Custom effects" below). For a **Ranged** weapon only, a **Reload** selector also appears here: 0 (off, the default — this weapon can't be bought with Focus at all), 1 or 2 (this weapon can be bought that many times total, shared across the whole sequence, exactly like Focus itself), or ∞ (unlimited buys, exactly like a melee weapon — see "Buy an extra attack" above).
- **Attack** (to-hit roll modifiers): Discard lowest, Discard highest — discards the lowest and/or the highest die before summing; **both can be active at the same time** on the same roll —, Reroll (optional reroll if the roll would miss), Sanguine Fate, Boosted (adds one extra die to the attack roll for free, no Focus spent — and makes this roll ineligible for a Focus-funded boost on top, since a roll can only be boosted once).
- **Damage** (damage roll modifiers): Discard lowest, Discard highest (same rule: stackable), Reroll (optional reroll if the roll is below average), Trash, Shatter, Chain Weapon (ignores the target's Shield ARM bonus specifically — nothing else), Boosted (same idea as the Attack section's own Boosted, but for the damage roll).
- **On hit** / **On crit**: every effect that can trigger on a hit and/or on a critical hit (Armor Piercing, Decapitation, Sustained Attack, Knockdown, Stationary, Ice Cage, Shadowbind, Blind, Paralysis, Flare, Weaken, "-X ARM", Dispel, Grievous Wounds) appears in both categories, once each, under the same name. Activating an effect's button under "On hit" triggers it on any hit (crits included); activating it under "On crit" restricts it to critical hits only; the two buttons for a given effect are mutually exclusive (activating one deactivates the other). **Sustained Attack**: once one shot from this weapon's own volley — its # Atks and/or ROF shots — hits (if activated under "On hit") or specifically crits (if activated under "On crit"), every later shot in that same volley automatically hits too; doesn't reach a different weapon row, even one representing the same physical weapon. Brutal Damage and Critical Shred only appear under "On crit" (neither can ever trigger on a plain hit). When **"-X ARM"** is active (in either category), an amount selector (1 to 10) appears at the bottom of the pop-up.
- **Reset**: a button at the bottom of the pop-up that deactivates every effect on this weapon at once (Auto-hit included), so the player can start over from a "clean" weapon instead of unchecking effects one by one — # Atks/Type/ROF/Dice/POW live on the card itself and aren't touched by this.

The **"+ Add attacker"** button below the list adds a new attacker with one default weapon.

**Card order is resolution order.** The app doesn't automatically search for the best possible order: attacks resolve top attacker to bottom, top attack to bottom within each attacker — this is a deliberate choice (see "Product choices" below) — it's up to the player to define the order they intend to play, just as they would at the table, using the drag handles to arrange attacker and attack cards accordingly.

### 3. Results

**With a single target** (the common case), two figures are shown:
- **Chance to destroy**: total probability of destroying the target over the whole sequence.
- **Average damage**: expected total damage dealt over the whole sequence (unconditional — a destroyed target's exact overkill isn't tracked, so a destroyed outcome counts as exactly `boxesInitial` damage, same convention as the "N+" bucket in the damage distribution below).

**With more than one target**, the two gauges are replaced by a single **"Chance to destroy all
targets"** line — the per-target breakdown (chance to destroy, average damage) moved into the
Details pop-up's own tabs (below) to keep this section compact regardless of how many targets are
configured. A target only waits behind an earlier one if it genuinely shares a weapon with it —
every weapon scoped away from every earlier target fires at it regardless of what happens to them
(see "Weapon range" above). (A target that a specific weapon can never reach — see "Weapon range"
above — still shows 0% destroyed and 0 average damage from that weapon's own share: no damage, full
boxes.)

**"Chance to destroy all targets"** is the true joint probability every target dies, not just each
one's own chance multiplied together — two targets sharing a weapon aren't independent (the same
dice decide both of their fates), so naively multiplying can be badly wrong in either direction. Two
targets that share no weapon at all really are independent, so multiplying works exactly there.

A small **query_stats** icon opens a pop-up with the full breakdown (always the first target once
there's more than one — the tab row described below lets the player switch from there). With more
than one target, a row of tabs at the top of this pop-up — one per target, each showing its own
chance to destroy AND average damage — lets the player switch which target's breakdown is shown
below; with a single target, this tab row is hidden entirely and the pop-up looks exactly as it
always has:
- **Focus strategy**: shown only when at least one attacker in the sequence has Focus active — one
  sentence per (Focus-enabled attacker, target) pair the attacker actually engages, above "Step by
  step", summarizing the app's computed spending policy for that attacker against that specific
  target (see "Focus" above), naming the exact weapon each boost or buy applies to (e.g. "boost
  Ranged's attack rolls" or "buy extra attacks with Melee1") — an attacker using different weapons
  differently against different targets gets one line per target rather than one blurred-together
  sentence for the whole fight. With a single target, the "vs Target Name" suffix is dropped since
  there's nothing to disambiguate.
- **Step by step**: one row per actual ATTACK, not per weapon — a weapon firing several times (via `# Atks` and/or ROF) gets one row per shot, numbered continuously across the whole sequence (numbering never restarts at a weapon boundary). Each weapon's own rows are grouped under a small header showing its type icon (🗡️/🏹/🪄) — the owning attacker's name is shown too, but only the first time that attacker appears (consecutive weapons from the same attacker just repeat the icon, not the name). Each row shows: *Chance* (the odds this particular shot actually fires at all — always 100% for a guaranteed shot, and less than 100% for a shot past a weapon's guaranteed `# Atks` base whose firing depends on ROF's roll, a `# Atks = 0` pure-ROF weapon's very first shot, a shot that never gets reached because an earlier shot in the SAME weapon's volley already destroyed the target, or — with more than one target — a shot that never gets reached because an earlier TARGET is still alive when the sequence runs out), *Hit* (chance to hit), *Crit* (chance of a critical hit, a double on the to-hit roll), *Avg damage* (average damage dealt by this attack's damage roll, dice + POW − ARM). Hit/Crit/Avg damage are all conditional on the target still being alive AND this specific shot actually firing (see *Chance*) — "if this shot happens, here's what to expect from it" — and don't account for any Focus/Fury mitigation (they're properties of the attack itself, not of the sequence's outcome). Each row's own label sits above its value rather than beside it, so the whole row always fits the pop-up's width without needing to scroll sideways. With more than one target selected in the tab row above, a weapon that isn't in THIS target's own range (see "Weapon range" above) contributes no rows at all — each target's own list only ever shows the weapons that could actually hit it.
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
- **Blessed**: this attack ignores the target's DEF/ARM bonus from BOTH "Spells" and "Upkeep spells / Animi" (see "Custom effects" below — both are always spell-sourced, so both are always Blessed-ignorable). Shield, Unyielding, Carapace, and any "Dispellable special rules" grant are all unaffected, since none of those are stat bonuses.
- **Chain Weapon**: this attack ignores the target's **Shield** ARM bonus specifically — nothing else (not stat bonuses, not Unyielding/Carapace).
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
- **Dispel**: removes every "Dispellable special rules" grant (**Unyielding**/**Tough**, see above) and the "Upkeep spells / Animi" DEF/ARM bonus from the target, for the rest of the sequence — the "Spells" bonus is unaffected (it's permanent, not removable by Dispel). Permanent capabilities toggled directly in "Special rules" are never affected either. Like the other persistent effects, once triggered it applies to every later attack in the sequence, never the attack that triggered it.
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

### Custom effects

Warmachine/Hordes has far too many spells to list individually, and each one grants either a flat stat bonus or a named capability for the rest of the game. A granted **Tough** or **Unyielding** is covered by the **"Dispellable special rules"** toggles above — the Target profile pop-up's **"Upkeep spells / Animi"** and **"Spells"** sections cover the other case: a flat DEF and/or ARM bonus (0 to 10 each, independently — most spells grant just one, but a few grant both at once), applied unconditionally (regardless of attack type). Both sections' bonuses are always ignored by an attack's **Blessed** effect (both are genuinely spell-sourced, by definition) — they only differ in whether an attack's **Dispel** effect removes them:

- **Spells**: permanent for the whole sequence (a one-shot spell effect that already resolved) — **Dispel** can't remove it.
- **Upkeep spells / Animi**: removable by an attack's **Dispel** effect, for the rest of the sequence.

Both totals are cumulative with everything else (Shield, Unyielding, Carapace, ...) and with each other — a model can have a DEF/ARM bonus from both "Spells" and "Upkeep spells / Animi" at once.

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
- **Custom effects are the one deliberate exception, by necessity**: since Warmachine/Hordes has far too many spells to name individually, the Target profile's "Upkeep spells / Animi"/"Spells" sections let the player enter a raw DEF/ARM total instead of picking a named, pre-validated effect. A granted **rule** (Tough/Unyielding) instead reuses the same "Special rules" toggles via "Dispellable special rules," keeping attack-type conditions (Unyielding/Carapace) and Tough/Tough Steady exclusivity correct for free, rather than reimplementing them a second time for the spell path. An earlier version tracked each spell as its own named, repeatable entry (with independent Spell/Dispellable toggles, so a non-spell source like a feat could also be represented); once real usage showed players only ever cared about the RUNNING TOTAL per category, not each individual spell's name, that per-entry model was replaced with the current two fixed DEF/ARM totals per category — simpler to use, at the cost of no longer being able to represent a non-spell (feat) stat bonus through this UI at all.
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
- **Multiple targets redirect mid-volley, not just between weapons**: when the current target dies partway through a multi-shot weapon's own volley (`# Atks`/ROF), that SAME weapon's remaining shots redirect to the next target immediately, matching the tabletop rule precisely - chosen over the simpler (and cheaper to compute) alternative of only switching targets between whole weapons, after weighing the tradeoff explicitly (see the technical documentation for the engine design this required). A weapon whose own range doesn't cover the newly-current target simply stops firing for the rest of that row rather than searching further down the target list for one it CAN hit - a deliberately narrower rule than "always find any valid target," kept simple and predictable rather than trying to guess intent.

## Roadmap

- Icons and final PWA manifest configuration.
- Verification of the display on smartphones (in progress).
- Manual "Add to Home Screen" instructions for Safari (iOS and desktop) - the only browser that never fires the `beforeinstallprompt` event the install banner relies on, so it currently just never appears there instead of offering any alternative.

### Larger features under consideration

Rough sizing (S/M/L/XL), for prioritization purposes only - not a commitment on scope or order:

- **Damage grids for warjacks** (location-based systems - Movement, arms, etc. - each with their own boxes, crippled independently, plus a "chance to cripple system X" stat) — **XL**. The biggest item here by a wide margin: today's model is one target with one box pool: this needs a genuinely new sub-model (hit-location resolution, per-system boxes and crippled state, grid degradation) that current results (single "chance to destroy") don't map onto directly.
- **Custom reroll strategy** (reroll on a miss, reroll if not a critical, etc., instead of always the mathematically optimal policy) — **S/M**. `rerollPoolOnceIf` (`dice-pool.ts`) already takes an arbitrary "is this roll bad?" predicate - today's fixed policy is just the ONE predicate the app happens to expose. Mostly UI work (a way to pick the condition) plus a handful of new named predicates; low architectural risk since the underlying mechanism already generalizes.
