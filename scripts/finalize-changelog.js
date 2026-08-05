#!/usr/bin/env node
/**
 * finalize-changelog.js
 * ----------------------
 * Run by .github/workflows/deploy.yml, right before the production build, on every push to
 * `develop` - replaces the changelog's `'Unreleased'` placeholder (see changelog.data.ts's own
 * module doc comment) with today's date the moment a change actually reaches `develop`, so
 * "Unreleased" never ships to a real player and the changelog's own newest date always matches
 * when that entry actually went live (see `LATEST_CHANGELOG_DATE`).
 *
 * A no-op (exits 0, reports nothing changed) whenever there's no `'Unreleased'` entry to finalize -
 * true for most pushes, since not every change lands alongside a new feature/fix worth dating.
 */
const fs = require('fs');
const path = require('path');

const CHANGELOG_PATH = path.join(__dirname, '..', 'src/app/odds-calculator/changelog-dialog/changelog.data.ts');

const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD, UTC - matches every other date in this file

const original = fs.readFileSync(CHANGELOG_PATH, 'utf8');
const updated = original.replace(/date:\s*'Unreleased'/, `date: '${today}'`);
const changed = updated !== original;

if (changed) {
  fs.writeFileSync(CHANGELOG_PATH, updated);
  console.log(`Finalized changelog: 'Unreleased' -> '${today}'`);
} else {
  console.log("No 'Unreleased' changelog entry to finalize - nothing to do.");
}

if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\n`);
}
