/**
 * sequence.ts
 * -----------
 * A full attack sequence: any number of attackers, each with any number of
 * attacks, applied IN ORDER against a single shared target. This is the
 * "assassination run" calculation - e.g. "will these 10 attacks combined
 * destroy that warjack?"
 *
 * The target may also have Focus and/or Fury points to spend defensively:
 * once per attack, after damage is rolled, it may spend one point (focus OR
 * fury, never both) to reduce or negate that hit - see `bestAction` below.
 * We assume the target always spends optimally, which requires looking
 * AHEAD at the rest of the sequence (a point saved now might matter more
 * later), not just reacting to the current hit. That's computed by backward
 * induction (`valueTables`) before replaying the decisions forward to get
 * the step-by-step numbers the UI shows.
 *
 * On top of that, attacks can inflict PERSISTENT debuffs on the target
 * (Knockdown, Stationary, Ice Cage, Shadowbind, Blind, Paralysis, Flare,
 * Weaken, a generic ARM debuff, Dispel) that change its DEF/ARM for the REST
 * of the sequence - see `DebuffState` below. These evolve independently of
 * the Focus/Fury sub-problem (spending a resource point never changes
 * DEF/ARM), but they do interact at two points: surviving a Tough roll
 * always also knocks the target down, and a Knocked Down/Stationary target
 * can't attempt a plain Tough roll at all (Tough Steady is immune to that
 * second coupling - see `damageBranches`).
 *
 * The target can also carry static, sequence-wide bonuses - Shield/Unyielding/
 * Carapace/generic spell bonuses - resolved once per attack context in
 * `profileFor`, same as the printed DEF/ARM stats they sit on top of. Some of
 * these are spell-granted rather than innate to the model, which is why each
 * one comes in a PRE-Dispel/POST-Dispel pair (`SequenceTarget.spellArmBonus`/
 * `spellArmBonusPostDispel`, `unyielding`/`unyieldingPostDispel`, etc.) -
 * `profileFor` picks whichever half of the pair matches `debuffState.dispelled`.
 * Two more per-attack toggles narrow which of these a SPECIFIC attack sees at
 * all, regardless of Dispel: Blessed (`SequencedAttack.blessed`) ignores every
 * Stat-type bonus flagged Spell - a non-spell Stat-type bonus (a feat, a
 * non-spell aura, see `nonSpellArmBonus`/`nonSpellDefBonus`) is never
 * Blessed-ignorable - and Chain Weapon (`SequencedAttack.chainWeapon`)
 * ignores Shield's ARM bonus - see `profileFor`.
 *
 * Rapid Healing (`SequenceTarget.rapidHealing`) adds a THIRD sub-problem on top of Focus/Fury and
 * the persistent debuffs: after any hit that deals nonzero RAW damage and doesn't destroy the
 * target (Tough already resolved), the target rolls a d3 and heals that many boxes, capped at its
 * starting box count - see `healBranches`. "Raw" matters here: whether Rapid Healing triggers is
 * decided by the damage the attack dealt BEFORE any Focus/Fury mitigation, not by how much of it
 * actually reached the target's boxes - spending a resource point to blunt or fully negate a hit
 * doesn't undo the fact that the target was hit, it just softens the consequence, so `bestAction`
 * carries that original value alongside whichever mitigated amount a given candidate action
 * produces. Grievous Wounds (a `StatEffectType`, like Dispel a `DebuffState` flag) turns Rapid
 * Healing off for the rest of the sequence once inflicted, and also removes Tough/Tough Steady
 * entirely (on top of the existing Knocked Down/Stationary negation, which only ever affected
 * plain Tough) - see `damageBranches`.
 *
 * Critical Shred (`SequencedAttack.criticalShred`) is the odd one out architecturally: every other
 * effect only ever changes DEF/ARM/boxes/debuffs for a FIXED, known-in-advance sequence of
 * attacks. Shred means a crit makes this SAME attack fire again, immediately, against whatever
 * state resulted from the first (which can itself crit and fire again...) - so the number of dice
 * rolls "at position k" becomes a random variable, not a constant. This is modeled as a small
 * self-referential value problem local to position k: `attackChainValue` (backward induction) and
 * `resolveAttackChainForward` (forward simulation) both resolve one attack instance and, on a
 * crit with Shred active, recurse into ANOTHER instance of themselves instead of falling through
 * to the next attack - up to `MAX_SHRED_DEPTH` instances deep, since each further instance
 * requires another crit and therefore contributes probability that shrinks geometrically
 * (`critChance^depth`); truncating there leaves an error far below floating-point-visible
 * precision for any realistic crit chance, the same kind of documented simplification as Tough's
 * "no once-per-turn limit". A Shred chain can trigger the SAME crit-only persistent effect (Ice
 * Cage, "-X ARM") repeatedly, once per instance in the chain - `getValueTableAt` (see "Lazy value
 * tables" below) needs no special handling for this: whatever `DebuffState` a real chain instance
 * actually produces gets its own value table built on first request, regardless of how many
 * repeated crit applications it took to reach. In the step-by-step breakdown, "Avg
 * damage" is the TOTAL expected damage across a whole chain (what actually happens at that
 * position), but "Hit"/"Crit" chance stay the ORIGINAL roll's own - a single well-defined
 * probability, unlike "average damage" which stays meaningful however many rolls occurred.
 *
 * Every attack fires `SequencedAttack.attackCount` shots as its guaranteed base (1-10, defaults to
 * 1) - a fixed, always-known repeat count set by the player, applying to every attack type. Rate
 * of Fire (`SequencedAttack.rof`, ranged-only) adds EXTRA shots on top of that base - the extra
 * count is decided ONCE via a die roll before any of this attack's own dice are thrown, unlike
 * Critical Shred's per-instance crit-triggered recursion: by the time the target is deciding
 * whether to spend Focus/Fury on shot i, it already knows the total shot count K for the whole
 * volley (common knowledge the moment the attacker rolls ROF, before any attack/damage dice), not
 * merely an average over an unknown future. That's why
 * `buildShotsValue`'s backward-induction helper builds one memoized value function PER POSSIBLE
 * "shots remaining" count, rather than folding ROF into a single blended lookahead the way a
 * crit-triggered continuation could: `shotsValue(s, ...)` is "resolve one more shot of this same
 * attack (itself already Shred-aware via `attackChainValue`), then `shotsValue(s-1, ...)`
 * afterward", bottoming out at `shotsValue(0, ...)` = the ordinary "attacks k+1 onward" value. The
 * forward simulation (`resolveRofAttackForward`) mirrors this exactly, per possible shot count K:
 * splits the incoming probability mass by `rofOutcomes`, then resolves K shots in sequence within
 * each K-branch, reusing the SAME `shotsValue` functions the backward pass built so the replayed
 * Focus/Fury policy matches what was actually optimized for. The step-by-step breakdown shows each
 * shot's own Hit/Crit/Avg damage separately (`SequenceStepResult.shots`, one `SequenceShotResult`
 * per possible shot index) rather than collapsing a whole volley into one row: `resolveRofAttackForward`
 * accumulates a SEPARATE `ShotStats` object per shot index (shared across every K-branch that reaches
 * that far), including `occursMass` - the probability mass that actually attempts that shot, letting
 * `SequenceShotResult.occursChance` show a variable-count weapon's later shots as less than certain.
 *
 * Sustained Attack (`SequencedAttack.sustainedAttack: 'hit' | 'crit'`, a hit/crit-pair effect like
 * Armor Piercing/Decapitation - see `HIT_CRIT_PAIR_KEYS`) auto-hits every LATER shot in THIS SAME
 * weapon's own volley once an earlier shot has hit (`'hit'`) or specifically crit (`'crit'`) -
 * scoped to one row's own `attackCount`/`rof` shots only, never carrying into a different weapon
 * row. This rides the exact same per-shot threading `pmMask`/`kotdOffLeft`/`kotdDefLeft` already
 * use (a `sustained: boolean` appended to `ExtendedValueLookup`/`FwdState`), with one crucial
 * difference: those three persist across the WHOLE sequence (folded into `tableKey`/
 * `getValueTableAt`), while `sustained` must reset to `false` the instant a NEW row's shot loop
 * begins - it's threaded through `attackChainValue`/`resolveAttackChainForward`/`buildShotsValue`'s
 * `shotsValue`/`resolveRofAttackForward` (all already row-loop-scoped, exactly like
 * `shotsRemainingThisRow`/`depthRemaining`), but deliberately never added to `ValueTable`/
 * `tableKey` itself (which represents "attacks k+1 onward", i.e. a DIFFERENT row). `resolveOneOutcome`
 * is where it's actually decided: `outcomeSustained = sustained || (atk.sustainedAttack === 'hit'
 * && outcome.isHit) || (atk.sustainedAttack === 'crit' && outcome.isCrit)`, then threaded into both
 * the Shred-continuation recursion (so a Shred-triggered follow-up attack sees a just-turned-on
 * flag too) and whatever comes after this shot (the next shot in the volley, or the next row once
 * shots run out).
 * `contextFor` folds it into the SAME `usesAutoHit` boolean `forceAutoHit` already sets, so every
 * existing "auto-hit never crits" / Puppet Master reroll / Knowledge of the Damned reserve-rule
 * behavior applies to a sustained-forced hit for free, with no new branching anywhere else.
 *
 * Multiple targets (`computeMultiTargetSequenceOdds`, `SequencedAttack.eligibleTargetIndices`) -
 * attacks go against the first target until it's destroyed, then spill onto the next, and so on.
 * Each target has its own fully independent DEF/ARM/boxes/debuffs/Focus/Fury/Knowledge of the
 * Damned/Shield Guards/Scapegoats - a target's own optimal defensive play never depends on any
 * OTHER target, only on which attacks it faces, in what order, starting from what row/shot. That
 * means each target's own survival is answerable by running this SAME single-target engine once
 * per target, completely unmodified in its expensive part (the backward induction), chained
 * together by a "fresh mass enters the fight partway through" mechanism (`SequenceOptions.injection`,
 * `RowInjection`) rather than modeling every target jointly (which would blow up the state space
 * combinatorially). A weapon can be scoped to a subset of targets ("in range of" -
 * `eligibleTargetIndices`, unset = every target); an out-of-range row is a pure no-op for that
 * target (`SequenceOptions.rowActive`) - `getValueTableAt[k]` aliases straight to
 * `getValueTableAt[k+1]` in the backward pass, and the forward pass leaves `dist` untouched.
 *
 * The handoff between targets happens at SHOT granularity, not just row (weapon) boundaries: if
 * shot 2 of a 5-shot ROF weapon destroys the current target, shots 3-5 of that SAME weapon
 * redirect to the next one, matching the tabletop rule precisely. This works because
 * `buildShotsValue`'s `shotsValue(s, ...)` already answers "value of s more shots of row k's
 * weapon, then rows k+1 onward" for every possible `s` - that's its entire purpose, already built
 * and memoized per row for the ROF feature above. A mid-row handoff is just the forward pass
 * starting some fresh probability mass at that same coordinate instead of only before row 0 - no
 * backward-induction change needed. `resolveRofAttackForward` tracks each row's own destroyed mass
 * bucketed not by absolute shot index but by `shotsRemainingAfter` (`SequenceStepResult
 * .destroyChanceByShotsRemaining`) - the exact "how many of this row's own shots are still owed"
 * coordinate the next target needs to resume firing (`RowInjection.shotsRemaining`), K-invariant
 * unlike absolute position (different ROF branches reach a given remaining-count at different
 * absolute shot indices). A resumed volley does NOT get a fresh ROF roll (the weapon's total shot
 * count for THIS volley was already decided, before the target it's now facing ever came under
 * fire) - it fires exactly the inherited count, starting from the new target's own fresh state
 * (full boxes, no debuffs, full resources). Since there's no single true absolute position for a
 * resumed volley's own shots (again, K-branch-dependent), they're reported into `shots[]` as if
 * resuming at the position that leaves exactly that many shots before the row's maximum possible
 * count ends - a REPORTING simplification only (which row of the Details breakdown a shot's stats
 * land in), never affecting any actual probability. Sustained Attack's `sustained` flag does NOT
 * reset on a mid-row handoff (only on a genuine new row) - the weapon itself is "sustaining",
 * independent of which target it's currently hitting.
 *
 * `computeMultiTargetSequenceOdds` runs each target sequentially: target 0 with the default
 * `available` schedule (100% fresh before row 0). Each target only consumes the slice of
 * `available` landing on rows it's actually eligible for (`ownInjection`); the REST - mass on rows
 * this target was never even a candidate for - carries forward UNCHANGED to the next target
 * (`passthrough`), rather than being dropped: a weapon scoped away from one target is still exactly
 * what a LATER target further down the list might need, regardless of whether the target(s) in
 * between ever die. (An earlier version of this dropped that passthrough mass - making a weapon
 * scoped to target 2 only wait behind target 1 even though it can never touch target 1 at all - a
 * real bug, not a deliberate simplification; fixed once reported.)
 *
 * Passthrough alone isn't quite enough, though: `available` only ever holds EXPLICIT entries, never
 * an implicit "100% is still available at every untouched row". That's invisible for target 0 (its
 * first row IS row 0, exactly where the default entry already sits), but breaks for a LATER target
 * whose own first eligible row has no earlier-ranked target eligible for it either - there is no
 * rival that could ever "hold" that row, so it should be unconditionally, guaranteed reachable the
 * moment the sequence gets there, same as target 0's row 0 - yet nothing upstream ever had a reason
 * to produce an `available` entry AT that row, so a pure passthrough/death-handoff chain sees 0%
 * there. `computeMultiTargetSequenceOdds` detects exactly this ("this target's own first eligible
 * row has no earlier-ranked co-eligible target") and tops that row up to a full, unconditional 1,
 * REPLACING whatever partial/coincidental mass the chain happened to carry there - a target scoped
 * to a completely disjoint set of weapons from every earlier target is thus fully independent of
 * them, exactly as it should be. (This is a narrower, deliberate simplification for the rarer case
 * of a target with BOTH such an unrivaled row AND a later row it genuinely shares with an earlier
 * target: once its own mass is flowing from the unrivaled entry point, a later shared row is treated
 * as unconditionally active rather than gated by that earlier target's own survival odds - i.e. it
 * can slightly overstate how often the shared row actually reaches this target. Every case the
 * feature was designed for - fully independent weapons, and a single shared "general" weapon handing
 * off to per-target dedicated ones - is exact.)
 *
 * Target t+1's own `available` is the passthrough UNION target t's own newly-destroyed mass,
 * converted to `RowInjection`s exactly as before (row k+1 if t died on row k's own last shot, row k
 * itself for a genuine mid-volley resume). Cost is linear in target count: each target's own run is
 * the same complexity class as today's single-target computation, since the backward induction (the
 * expensive part) is unchanged - only the forward pass gets a constant-factor more bookkeeping.
 *
 * `chanceToDestroyAllTargets` answers a DIFFERENT question than any single `TargetSequenceResult`
 * does: not "what's target N's own chance to die" but "what's the chance every target dies", a true
 * joint probability - see its own doc comment for why that's NOT simply the product of every
 * target's own `finalDestroyChance` (two targets sharing a weapon are correlated) and how it's
 * still computed cheaply from data `computeMultiTargetSequenceOdds` already produces, with no new
 * engine machinery.
 *
 * Puppet Master (`SequencedAttack.hasPuppetMaster`, one bit per distinct `attackerIndex` with it
 * active - see `pmMask` below) grants ONE ATTACKER a single shared reroll token, spendable once on
 * ANY of that attacker's own attack or damage rolls, across every attack it makes. Deliberately
 * modeled as a FIXED, mechanical rule rather than an omniscient-optimal spend (unlike Focus/Fury):
 * an optimal spend would let the app claim a higher destroy chance than a real player, who doesn't
 * know in advance which roll the token would be "best" saved for, could actually achieve. The rule
 * (`resolvePmSplit`), walking this attacker's own rolls in order while the token is still unspent:
 *   1. A roll with a genuine to-hit chance (not auto-hit): reroll it if it would MISS - "the first
 *      missed attack roll". If it hits, the token stays unspent and carries forward untouched.
 *   2. A roll that's auto-hit (no to-hit roll to miss) only gets a DAMAGE-roll check instead - and
 *      only once it's clear waiting longer serves no purpose: EITHER every one of this attacker's
 *      REMAINING attacks is guaranteed auto-hit too (so rule 1 can structurally never fire again),
 *      OR this is this attacker's LAST attack (so there's no later roll to save the token for
 *      either way). Below that point, reroll the damage roll if it's below average; otherwise the
 *      token carries forward unspent (there's nothing to gain from spending it here).
 *   3. The SAME damage-roll check ALSO applies to a non-auto-hit roll's damage, but only as a
 *      second chance on a roll that already passed rule 1 (hit normally) while ALSO satisfying
 *      rule 2's "nothing left to wait for" condition (same OR: guaranteed-auto-hit-for-the-rest, or
 *      this is the last attack) - otherwise a hit that isn't the last opportunity just moves on,
 *      preserving the token for a later roll that might still miss.
 * If the token is still unspent after the attacker's last attack, it goes unused - by design (see
 * point 1 above): the app doesn't get to pretend a resource a real player might genuinely never
 * find a good use for was spent anyway.
 *
 * Since "will every remaining attack of mine inevitably auto-hit" only ever depends on information
 * ALREADY known at this point in a given branch (Knocked Down/Stationary, once inflicted, never
 * clears - see `DebuffState` - and `forceAutoHit`/`type` are static per attack), this is a genuine
 * forward-only, no-lookahead rule: `resolvePmSplit` never needs to peek at how any LATER roll
 * happens to turn out, only at the CURRENT debuff state plus the attacker's own static attack list
 * (`isAutoHitGuaranteedForRest`/`isLastAttackOfAttacker`).
 *
 * A "reroll" here is mathematically just an i.i.d. redraw from the SAME pool the original roll came
 * from - so `resolvePmSplit` never needs to build a genuinely NEW profile for the "rerolled" case:
 * a miss's own reroll is, by construction, the SAME to-hit distribution the miss itself was drawn
 * from (see the file header's Reroll note); a below-average damage roll's own reroll is likewise
 * exactly `splitAttackDamageForPuppetMaster`'s full, unconditional distribution again. What
 * `resolvePmSplit` actually returns is a small SET of `(profile, resultingMask)` populations that
 * ALL genuinely happen (each already correctly pre-scaled to its own share of the roll) - e.g. "hit
 * normally, mass = hitChance, mask unchanged" plus "missed then rerolled, mass = missChance, mask
 * now spent" - which the caller just sums over like any other outcome, no comparison/decision
 * needed at that point (contrast this with `bestAction`'s genuine 3-way comparison for Focus/Fury,
 * which Puppet Master never needed in the first place, being a fixed rule rather than a choice).
 *
 * `pmMask` still threads through the SAME grid Focus/Fury already occupies (`boxes/focus/fury`), as
 * one more small, densely-enumerated dimension (folded into the `Map<string, ValueTable>` key
 * alongside `DebuffState`, not a new `ValueTable` array axis - see `tableKey`) - NOT into
 * `bestAction`/`ValueTable`/`ValueLookup` themselves, which stay entirely unaware Puppet Master
 * exists: the mask only ever changes ONCE, atomically, at the point `resolvePmSplit` builds each
 * population, strictly BEFORE that population's own outcomes are enumerated - by the time
 * `bestAction` runs, whether the token was just spent is already baked into which profile produced
 * the outcome it's reacting to, exactly like the row's own `rerollAttack`/`rerollDamage` toggles
 * are baked into a profile before `bestAction` ever sees it. This still has to live one level ABOVE
 * `bestAction` (the SAME level `attackChainValue` already resolves Shred's recursion and
 * `buildShotsValue` already resolves ROF's per-shot lookahead at) purely because Focus/Fury's OWN
 * optimal spending needs to know, in advance, which profile a LATER roll will actually draw from -
 * which is exactly why the token is independently re-checked at every Shred instance and every ROF
 * shot, not just an attack's first roll: both already thread their own state through
 * `attackChainValue` the same way `pmMask` does.
 *
 * Knowledge of the Damned (`SequenceTarget.offensiveKnowledgeOfTheDamned`/
 * `defensiveKnowledgeOfTheDamned`, `kotdOffLeft`/`kotdDefLeft`) is TWO more reroll-granting
 * resources, both living on the TARGET (unlike Puppet Master, which is per-attacker) and shared
 * across EVERY attacker in the sequence - a pool of 0-10 charges each, not a single token.
 *
 * Offensive Knowledge of the Damned is, mechanically, Puppet Master generalized from "1 token,
 * scoped to one attacker" to "N pooled charges, shared globally" - same fixed, no-lookahead rule
 * (`resolveKotdOffSplit`): reroll any missed attack roll unconditionally; reroll a below-average
 * damage roll only once it's SAFE to (the "reserve rule" - `damageRerollEligibleForOffKotd`):
 * eligible only when the charges that would remain afterward are enough to cover
 * `remainingMissableRollCount` - every remaining roll, system-wide across every attacker, that
 * could still miss. This collapses EXACTLY onto Puppet Master's own rule when `kotdOffLeft` is 1
 * (the only way `charges - 1 >= remainingCount` can hold with 1 charge is `remainingCount === 0`,
 * i.e. nothing left to miss - Puppet Master's exact condition). A Rate of Fire attack's OWN
 * remaining shots count exactly (`shotsRemainingThisRow`, already known once inside that row's own
 * volley - see the Rate of Fire section above); a LATER row's own ROF shot count isn't decided yet
 * at evaluation time, so its worst case (`maxShots`) is used as a safe upper bound. A Critical
 * Shred-active row is deliberately NOT expanded into multiple units, matching
 * `isAutoHitGuaranteedForRest`'s own row-level treatment.
 *
 * Defensive Knowledge of the Damned is architecturally the new piece: the TARGET'S genuinely
 * OPTIMAL choice (full sequence lookahead, exactly like Focus/Fury's own assumption) of whether to
 * force a reroll of EITHER the attack roll (if it's currently a hit) or the damage roll (if it's
 * currently above average) - whichever lowers the destroy chance more, or neither
 * (`resolveKotdDefChoice`). Unlike Focus/Fury (which only ever transforms a single already-REALIZED
 * damage number, post-hoc, inside `bestAction`), a reroll changes the underlying DICE - so this has
 * to live at the SAME profile level Puppet Master/Offensive Knowledge of the Damned already operate
 * at, comparing whole-profile candidates via `profileScore` (a new helper that aggregates
 * `bestAction`'s own `outcomeScore`/`isBetterScore` lexicographic comparison across every outcome a
 * candidate profile can produce, not just one) rather than `bestAction`'s own single-outcome
 * comparison.
 *
 * Both share a KEY principle with Puppet Master, made explicit now that THREE reroll stages can
 * apply to the same roll in sequence: a "reroll" is always an i.i.d. redraw from the roll's TRUE,
 * fully unconditional distribution (`trueOriginal = profileFor(k, atk, debuffState)`, computed ONCE
 * per roll and shared by every stage) - never from whatever partially-conditioned profile an
 * upstream stage happens to be holding (`inputProfile`). These two profiles are only identical for
 * Puppet Master (the first stage); every function below Puppet Master's own level takes BOTH
 * explicitly. The full pipeline, run once per roll inside `attackChainValue`: the row's own
 * `reroll` toggle (baked in by `buildAttackProfile` already) -> Puppet Master (`resolvePmSplit`,
 * per-attacker, fixed) -> Offensive Knowledge of the Damned (`resolveKotdOffSplit`, global, fixed)
 * -> Defensive Knowledge of the Damned (`resolveKotdDefChoice`, global, optimal - run once per
 * Puppet-Master-population x Offensive-Knowledge-of-the-Damned-population, since its optimal choice
 * can legitimately differ per resulting resource combination). This composition is exactly what
 * makes "a roll can be rerolled once by each rule, but by both an attacker-side rule AND the
 * target's own Defensive Knowledge of the Damned" hold: each stage transforms whatever profile the
 * previous stage produced, strictly sequentially, so a given physical roll is touched by at most
 * one Puppet-Master decision, at most one Offensive-Knowledge-of-the-Damned decision, and at most
 * one Defensive-Knowledge-of-the-Damned decision - never twice by the same rule.
 *
 * `kotdOffLeft`/`kotdDefLeft` thread through the exact same grid `pmMask` already occupies
 * (`tableKey`, `ExtendedValueLookup`, `FwdState`/`fwdKey`) - `bestAction`/`ValueTable`/`ValueLookup`
 * stay entirely unaware either exists, for the same reason they stay unaware of `pmMask`.
 *
 * Attacker Focus (`SequencedAttack.attackerFocus`, one 0-10 counter per DISTINCT `attackerIndex`
 * with it set - see `focusIndexOf`/`MAX_FOCUS_ATTACKERS` below) is the OFFENSIVE mirror of the
 * target's own Focus/Fury: a resource the ATTACKER spends, chosen true-optimally via the exact same
 * backward-induction machinery (not a fixed rule like Puppet Master). On any of its own rolls, an
 * attacker can spend one point to boost the attack roll OR the damage roll (+1 die, `RollModifiers
 * .boostDice`, once per roll each) - or, only at the boundary right after its own last CONFIGURED
 * attack (`isLastAttackOfAttackerForFocus`), spend one point to fire an extra melee attack with
 * whichever of its own weapons scores best (`buildBoughtAttacksValue`). Attacker Focus is one shared
 * pool for the WHOLE sequence (every target in a multi-target fight, not reset per target - unlike
 * every target-side resource, and unlike Puppet Master's own per-target reset) - `RowInjection.
 * attackerFocusRemaining` carries it across `computeMultiTargetSequenceOdds`'s own target-to-target
 * handoff (see multi-target.ts).
 *
 * Three genuinely new architectural pieces, in the order they compose:
 *   1. Boost-attack-roll (`resolveAttackerAttackBoostChoice`/`chooseAttackerAttackBoost`) is the
 *      OUTERMOST decision in the whole per-roll pipeline, unlike every other stage here - it changes
 *      what `trueOriginal` itself IS (see the "two profiles" principle above), and every downstream
 *      reroll stage redraws from `trueOriginal`, so it can't be inserted as a middle stage the way
 *      Defensive Knowledge of the Damned is. `attackChainValue` is now a thin memoizing wrapper
 *      around it; `pipelineScore` (extracted from `attackChainValue`'s old loop body) runs the
 *      REST of the pipeline once per boost candidate so the two can be compared.
 *   2. Boost-damage-roll (`resolveAttackerDamageBoostChoice`) sits between Offensive and Defensive
 *      Knowledge of the Damned's own stages, as a per-HIT-FLAVOR population split (like Puppet
 *      Master's own `resolvePmSplit`) rather than a single whole-profile candidate - by this point
 *      the attacker already knows crit-vs-non-crit, and each flavor can rationally decide
 *      differently. Deliberate scope cut: Defensive Knowledge of the Damned's own candidate scoring
 *      does not look ahead through this stage (folding it in would make `profileScore` call itself
 *      recursively on ever-smaller slices) - a narrow, rare-in-practice gap only when both effects
 *      are active on the very same roll.
 *   3. Buy-an-extra-attack (`buildBoughtAttacksValue`/`resolveBoughtAttacksForward`) is a value
 *      ladder over "this one attacker's own remaining Focus" shaped exactly like `buildShotsValue`'s
 *      own ROF ladder, hooked into the backward loop only at the boundary row - choosing the best of
 *      the attacker's own melee weapons (or stopping) via a plain scalar comparison, not
 *      `isBetterScore`'s lexicographic triple (these are whole downstream expected-values, not
 *      single-outcome branches). Deliberate scope cut: a bought attack reuses its weapon's own row
 *      index for Puppet Master/Offensive Knowledge of the Damned eligibility - exactly right for
 *      Puppet Master (a pure mask check) but can slightly mis-estimate Offensive Knowledge of the
 *      Damned's own "reserve" heuristic. `attackIndicesByAttacker` (unconditional on Puppet Master,
 *      unlike `pmAttackIndicesByAttacker`, and filtered by `rowActive` - a row inactive for THIS
 *      target because it belongs to a differently-scoped weapon must never be mistaken for "this
 *      attacker's own last row") is what makes the boundary detection correct per target.
 *
 * `attackerFocusLeft: number[]` (one slot per focus-enabled attacker, via `focusIndexOf`) threads
 * through the exact same grid `pmMask`/`kotdOffLeft`/`kotdDefLeft` already occupy (`tableKey`,
 * `ExtendedValueLookup`, `FwdState`/`fwdKey`) - Map-key-folded, never a dense `ValueTable` axis, for
 * the same reachability-pruning reason those three already are.
 *
 * The Focus strategy advice text (`summarizeFocusStrategy`) is read off data actually recorded
 * during the forward replay (`recordFocusPolicy`/`FocusPolicyLog`, on `SequenceContext` - the mutable
 * counterpart to `profileCache`), never a separate heuristic: each spend decision is tagged by a
 * coarse target "situation" (`situationOf` - healthy vs Knocked-Down-or-Stationary) and accumulated
 * per attacker, so the resulting sentence can branch by situation exactly when the computed
 * true-optimal policy itself does.
 *
 * Performance note: we do NOT branch into one probability tree per attack
 * (that would blow up combinatorially). Instead we track a small probability
 * distribution over the target's *state* (boxes remaining, debuffs, focus/fury
 * remaining) and fold each attack into it in turn. Each attack's dice-pool
 * enumeration (the expensive part) is cached per attack and per distinct
 * (DEF, ARM, status) context it's actually resolved against - contexts are
 * few in practice (bounded by how many debuff-inflicting effects are
 * actually configured across the sequence), so this stays effectively
 * instant even for ~10 attacks. `pmMask x kotdOffLeft x kotdDefLeft` (on top of the existing
 * `focusLeft x furyLeft`) IS a genuine multiplicative state-space cost when several of these
 * resources are configured at once with large point totals - the `MAX_RESOURCE_POINTS` cap (10,
 * same as Focus/Fury) is a direct, intentional part of this feature's spec rather than a
 * pathological edge case to guard against further, so the mitigation is on the OTHER side of that
 * cap instead: `getValueTableAt` (see "Lazy value tables" below) only ever builds a table for a
 * `(debuffState, pmMask, kotdOffLeft, kotdDefLeft)` combination some real branch of the computation
 * actually reaches, rather than eagerly building the full cross product regardless of reachability -
 * a short sequence can never actually spend anywhere near 10 charges, so most of that configured
 * range is never built at all in practice, even though the cap itself stays at 10.
 */

export type {
  StatEffectType,
  StatEffect,
  RofValue,
  SequencedAttack,
  SequenceTarget,
  SequenceShotResult,
  SequenceStepResult,
  SequenceResult,
  FocusStrategyEntry,
  RowInjection,
  SequenceOptions,
  TargetSequenceResult,
} from './types';
export { computeSequenceOdds, summarizeFocusStrategy } from './single-target';
export { computeMultiTargetSequenceOdds, chanceToDestroyAllTargets } from './multi-target';
