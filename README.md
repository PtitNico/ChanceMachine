# ChanceMachine

**[Open the app →](https://ptitnico.github.io/ChanceMachine/)**

A probability calculator for the **Warmachine / Hordes** tabletop miniatures games. It answers the question every player asks while planning a turn: *"if I chain these attacks in this order, what's my chance of destroying this target?"*

ChanceMachine is the spiritual successor to **OddsMachine**, an Android app no longer available on modern phones — built instead as an installable web app (PWA), so it works on Android, iOS, and desktop alike, online or off.

## What it does

Enter a target (DEF, ARM, remaining boxes, plus an optional profile — Tough, Shield, Unyielding, Carapace, spell bonuses, Focus/Fury), then build an ordered attack sequence (one or more attackers, each with one or more attacks) and its special rules. Results update **instantly** on every change, no "Calculate" button — and no dice are ever actually rolled: every number is an **exact enumeration** of every possible outcome, not a Monte Carlo simulation.

You get, for the whole sequence and at every step along the way:
- Chance to hit and chance to destroy the target
- Expected boxes remaining, and the full distribution of outcomes if the target survives
- A target that defends itself **optimally** — Focus/Fury spending is computed via backward induction across the whole sequence, not a naive "block this hit if it would kill me" reflex

Supports a wide, growing range of Warmachine/Hordes rules: Knockdown, Stationary, Ice Cage, Shadowbind, Blind, Paralysis, Flare, Weaken, Trash, Shatter, Armor Piercing, Decapitation, Brutal Damage, Critical Shred, Rapid Healing, Grievous Wounds, Dispel, Blessed, Chain Weapon, boost/reroll/discard dice modifiers, and more — see the [functional documentation](docs/functional-documentation.md) for the full, precise list of what's modeled and how.

Targeted rules edition: **Warmachine MK4**.

## Tech

Angular 21 (standalone components, signals, zoneless), TypeScript, Vitest — a pure-TypeScript calculation engine with no Angular dependency, and no backend: it's a fully static PWA (`@angular/service-worker`), deployed to GitHub Pages.

For an in-depth look at how the engine and UI are built, see the [technical documentation](docs/technical-documentation.md).

## Development

```bash
npm install
npm start          # dev server at http://localhost:4200
npm test            # unit tests (Vitest, via the Angular builder)
npm run build       # production build in dist/
```

## Feedback

Found a bug, or have a rule that isn't modeled correctly? Use the **Feedback** entry in the app's own menu, or [open an issue](https://github.com/PtitNico/ChanceMachine/issues).
