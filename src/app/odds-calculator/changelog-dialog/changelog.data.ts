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
    date: '2026-07-21',
    items: [
      'MAT/RAT/AAT on an attacker card now only show for the attack types it actually has - a melee-only attacker no longer shows RAT or AAT.',
      'Condensed the layout to fit more on screen: the DEF/ARM/Boxes row now shares a line with the Target title, and the standalone "Attack sequence" and "Results" titles were removed since the cards already make each section clear.',
    ],
  },
  {
    date: '2026-07-20',
    items: [
      'Attacks are now grouped by attacker: each attacker is its own card with a name and MAT/RAT/AAT shared by all its attacks, holding one sub-card per attack.',
      'Editing an attack now opens a single pop-up for both its values and its effects, instead of a separate Effects pop-up.',
    ],
  },
  {
    date: '2026-07-17',
    items: ['Added Rate of Fire (ROF) for ranged attacks: fire d3 or 2d3 shots instead of just one, resolved in sequence against the target.'],
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
