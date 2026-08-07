/**
 * changelog.data.ts
 * ------------------
 * Hand-maintained "what's new" list shown in the Changelog pop-up, newest entry first. Not every
 * commit belongs here - this is player-facing, not a git log. Assume the reader already knows
 * Warmachine/Hordes rules; describe what the app does differently now, as concisely as possible -
 * no rules tutorials, no restating obvious mechanics.
 *
 * This list also drives the whole "have they seen what's new" versioning scheme: there's no
 * separate version number anywhere in the app (see ChangelogDialog) - `LATEST_CHANGELOG_DATE`
 * (simply the first entry's date) IS the current version, compared directly against whatever date
 * a visitor last saw in localStorage.
 *
 * A feature still in development, on a branch not yet merged/pushed to `develop`, isn't live for
 * any player yet - it doesn't belong under a real date (that would claim it shipped on a day it
 * didn't). Collect everything still unreleased under one `date: '2026-08-05'` entry (sorted first,
 * add the entry if it doesn't exist yet) instead. Deciding where a change goes:
 * - A genuinely new feature, or a fix/change to a feature ALREADY on `develop`: add a new item
 *   under `'Unreleased'` (creating that entry if it doesn't exist).
 * - A fix/change to a feature that's ITSELF still only under `'Unreleased'`: that feature was
 *   never live, so a bug in it was never something a player hit - it isn't a "fix" and doesn't get
 *   its own item. Fold the correction straight into that feature's own existing item instead (only
 *   if the correction actually changes how the feature reads to a player - a pure implementation
 *   detail needs no changelog wording at all), rather than appending a second item about it.
 *
 * `'Unreleased'` never reaches an actual player: `scripts/finalize-changelog.js`, run by
 * `.github/workflows/deploy.yml` on every push to `develop` (right before the production build),
 * rewrites it to that day's real date automatically and commits the result - by the time anything
 * ships to GitHub Pages, the placeholder is already gone. Nothing here needs to remember to swap
 * it by hand.
 */
export interface ChangelogEntry {
  /** ISO date ('YYYY-MM-DD'), or the literal 'Unreleased' for work not yet merged/pushed to
   *  `develop` - see the module doc comment. Entries must stay sorted newest-first, with any
   *  'Unreleased' entry first of all. */
  date: string;
  items: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    date: 'Unreleased',
    items: [
      'Attacker Focus can now buy extra attacks with a ranged weapon too, not just melee: set Reload in that weapon\'s Effects pop-up (1, 2, or ∞ extra shots) to make it eligible, still spending from the same shared Focus pool.',
      'Added a "Boosted" toggle to a weapon\'s Attack and Damage sections: adds one extra die to that roll for free, no Focus spent - and, since a roll can only be boosted once, Attacker Focus won\'t offer to boost it again.',
      'Added Charge and Cavalry Charge to the attacker\'s special rules pop-up (mutually exclusive): both boost the attacker\'s first melee attack for free - Charge boosts its damage roll, Cavalry Charge boosts both its attack and damage rolls - using the same "Boosted" effect above, so it won\'t stack with that weapon\'s own Boosted toggle or with Focus.',
    ],
  },
  {
    date: '2026-08-07',
    items: [
      'ChanceMachine now supports attacker Focus! Focus is spent optimally to boost attack or damage rolls, or buy additional melee attacks. Check the Details view to see the optimal Focus spending strategy: buy or boost? Reload and automatic boost (charge, cavalry charge, etc) coming soon!',
    ],
  },
  {
    date: '2026-08-05',
    items: [
      'Added support for multiple targets, each with its own independent profile: attacks go against the first target until it\'s destroyed, then spill onto the next. Weapons can be scoped to specific targets ("In range of" in the Effects pop-up, at least one required) and always fire at their own first eligible target regardless of what happens to others. Results and Details show a per-target breakdown, plus a "Chance to destroy all targets" figure.',
    ],
  },
  {
    date: '2026-08-04',
    items: [
      'Fixed a bug where picking "1" die for an attack or damage roll had no effect - it silently rolled 2 dice anyway, same as picking "2".',
    ],
  },
  {
    date: '2026-07-30',
    items: [
      "Attacks are now grouped into weapons: each weapon row can fire a fixed number of times (1-10) in a row, on top of ranged weapons' existing variable ROF (the two now add together).",
      "Added the (Critical) Sustained Attack weapon effect: once an attack from a weapon hits (or crits), the rest of that weapon's attacks auto-hit.",
      'Reworked the Details "Step by step" breakdown into one row per attack, grouped under the owning attacker\'s name and weapon type icon, with a "Chance" column showing how likely a variable-count shot (from ROF or a shot past a destroyed target) is to happen at all.',
    ],
  },
  {
    date: '2026-07-29',
    items: [
      'The "-X ARM" attack effect is now one toggle button (e.g. "-6 ARM") - click it to pick the amount directly, instead of a separate toggle plus dropdown.',
      'Added a "Dispellable special rules" section to the target profile (Unyielding/Tough) - the same grants as "Special rules", but removable by an attack\'s Dispel.',
      'Simplified the target profile\'s spell DEF/ARM bonuses into two sections, "Spells" and "Upkeep spells / Animi" - track the total bonus per category instead of naming each spell individually.',
    ],
  },
  {
    date: '2026-07-24',
    items: [
      'Reworked the target profile\'s Spells section into "Custom effects": "Add dispellable effect" grants Tough/Unyielding (always removable by Dispel), "Add stat spell" grants a flat DEF/ARM bonus with independent Spell/Dispellable toggles - a non-spell bonus (Spell off) is no longer ignored by Blessed.',
      'Focus, Fury, Knowledge of the Damned, Shield Guards, Scapegoats, and Shield in the target profile are now single toggle buttons showing their value (e.g. "Shield Guards: 2") instead of a label plus dropdown. Focus and Fury stay mutually exclusive.',
    ],
  },
  {
    date: '2026-07-23',
    items: [
      "Added Knowledge of the Damned to the target profile: an Offensive counter (0-10) shares a reroll pool across every attacker; a Defensive counter (0-10) gives the target its own optimally-spent reroll pool. Both stack with Puppet Master and a row's Reroll toggle.",
      'Added Shield Guards (0-10) and Scapegoats (0-4): each blocks one ranged or melee attack outright (damage and effects), spent optimally like Focus/Fury.',
      'Slow calculations now show a "Calculating..." indicator with a live progress estimate instead of looking frozen.',
    ],
  },
  {
    date: '2026-07-22',
    items: [
      'Added Puppet Master: toggle it per-attacker (the gear icon on the attacker card) to grant that attacker a single reroll, used on the first missed attack roll among its own attacks - or, once nothing is left to miss, a below-average damage roll instead. It can go unused if neither ever comes up.',
    ],
  },
  {
    date: '2026-07-21',
    items: [
      'Attacks are now grouped by attacker: each attacker is its own card with a name and MAT/RAT/AAT shared by all its attacks (only shown for the types it actually has - a melee-only attacker no longer shows RAT or AAT), holding one sub-card per attack.',
      'Condensed the layout to fit more on screen: the DEF/ARM/Boxes row now shares a line with the Target title, and the standalone "Attack sequence" and "Results" titles were removed since the cards already make each section clear.',
      'Attackers and attacks can now be reordered by dragging - grab the handle on the left of each card.',
    ],
  },
  {
    date: '2026-07-17',
    items: [
      'Added Rate of Fire (ROF) for ranged attacks: fire d3 or 2d3 shots instead of just one, resolved in sequence against the target.',
    ],
  },
  {
    date: '2026-07-16',
    items: [
      'Added Critical Shred: an attack that fires again immediately on a critical hit, and can keep chaining on further crits.',
      'Moved the "Support this project" link into the menu.',
    ],
  },
  {
    date: '2026-07-15',
    items: [
      'Added Rapid Healing and Grievous Wounds effects.',
      'Added a menu (Reset / About / Feedback).',
      'Fixed Armor Piercing to correctly combine with ARM buffs and penalties (Shield, spells, Ice Cage...) instead of ignoring them.',
      'Fixed a display glitch on some phones where the layout could resize unexpectedly.',
    ],
  },
  {
    date: '2026-07-08',
    items: [
      'Added a target profile pop-up (Tough, Shield, Unyielding, Carapace, spell bonuses).',
      'Added Blessed, Chain Weapon, and Dispel attack effects.',
    ],
  },
  {
    date: '2026-07-07',
    items: [
      'Added a full attack-effects system: Knockdown, Stationary, Ice Cage, Shadowbind, Blind, Paralysis, Flare, Weaken, Trash, Shatter, Armor Piercing, Decapitation, and more.',
    ],
  },
  {
    date: '2026-07-06',
    items: [
      'Added optimal Focus/Fury spending: the target defends itself as effectively as possible against the whole sequence, not just reacting to the current hit.',
      'Added the attack-sequence calculator: chain multiple attacks, from one or several attackers, against a single target.',
    ],
  },
];

/** "Have they seen everything currently in the changelog" marker - see ChangelogDialog. */
export const LATEST_CHANGELOG_DATE = CHANGELOG[0].date;
