/**
 * changelog.data.ts
 * ------------------
 * Hand-maintained "what's new" list shown in the Changelog pop-up, newest entry first. Add a new
 * entry here (with today's date) whenever a change is worth telling a player about - new effects,
 * fixes that change a calculated result, notable UI changes. Not every commit belongs here - this
 * is player-facing, not a git log.
 *
 * This list also drives the whole "have they seen what's new" versioning scheme: there's no
 * separate version number anywhere in the app (see ChangelogDialog) - `LATEST_CHANGELOG_DATE`
 * (simply the first entry's date) IS the current version, compared directly against whatever date
 * a visitor last saw in localStorage.
 */
export interface ChangelogEntry {
  /** ISO date ('YYYY-MM-DD'). Entries must stay sorted newest-first. */
  date: string;
  items: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
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
      'Added Knowledge of the Damned to the target profile: an Offensive counter (0-10) shares a reroll pool across every attacker; a Defensive counter (0-10) gives the target its own optimally-spent reroll pool. Both stack with Puppet Master and a row\'s Reroll toggle.',
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
