export const MAX_RESOURCE_POINTS = 10; // far beyond any Warmachine/Hordes caster's focus/fury stat; guards the value-table size.

// Scapegoats are mechanically capped at 4 per the model - a genuinely smaller cap than every other
// resource here, not a tightened version of MAX_RESOURCE_POINTS.
export const MAX_SCAPEGOATS = 4;

// Purely a bitwise-safety ceiling for `pmBitOf`'s `1 << i` (undefined behavior once `i` reaches 31,
// since JS bitwise ops work on 32-bit ints) - NOT the real complexity gate anymore, that's
// `MAX_SEQUENCE_COMPLEXITY` below. Set generously loose since it only exists to keep the bitmask
// itself well-defined, not to bound cost (that's `MAX_SEQUENCE_COMPLEXITY`'s job, and it already
// folds in `2^pmAttackerCount` as one of its own factors).
export const MAX_PM_ATTACKERS = 16;

// A flat "how many DISTINCT attackers can have Focus active" cap used to live here (and a matching
// one for Reload-capped weapons) - removed: attacker COUNT alone is the wrong proxy for cost. 3
// attackers with 2 Focus each (`(2+1)^3 = 27` combos) is cheaper than 2 attackers with 10 Focus
// each (`(10+1)^2 = 121` combos), yet the old cap treated the first as forbidden and the second as
// fine. `MAX_SEQUENCE_COMPLEXITY` below replaces both counts with one estimate over the actual
// magnitudes that drive cost (see its own doc comment).

// Rough estimated "reachable (Map-keyed-state x boxes) combination count" ceiling -
// `(boxes+1) x (targetFocus+1) x (targetFury+1) x (shieldGuards+1) x (scapegoats+1) x
// (kotdOff+1) x (kotdDef+1) x 2^pmAttackerCount x` (per focus-enabled attacker) `(focus+1) x`
// (per finite-Reload weapon) `(reloadCap+1)`, computed in `computeSequenceOdds` right after every
// factor is known and validated. Every one of these dimensions is folded into the SAME
// `tableKey`/`ValueTable` Map key (see the module doc comment's relevant sections) or multiplies a
// table's own dense array size the same way `boxes` does, so their product is a reasonable,
// monotonic (if rough) proxy for how many value tables the lazy backward induction ends up
// building - NOT a promise of wall-clock seconds, since per-table cost still varies with row count,
// weapon count, and dice-pool sizes this estimate doesn't capture.
//
// Calibrated from real-world runs of the SAME 3-attacker/57-box scenario that originally prompted
// this, across two rounds with actual measured timings: threshold 5000 - Focus [3,1,1] (estimate
// 928) ran to completion in ~86s ("slow but tolerable" - `OddsEngine`'s Cancel action exists
// precisely for cases like this), Focus [3,6,6] (estimate 11368) still hadn't finished after 2+
// minutes, clearly worth rejecting, but 5000 turned out tighter than necessary; raised to 10000 -
// Focus [3,6,5] (estimate 9744) completed in ~4s (comfortably tolerable, not just "allowed"), while
// [3,6,6] still correctly rejected. Raised further still, to 100000, without a matching measured
// data point at THIS magnitude - past this point the estimate is even more of a coarse backstop
// than a tuned line, and `OddsEngine.cancel()`/`ResultsPanel`'s Retry action are the real safety
// net for finding out in practice whether a given legal-but-big config is actually tolerable.
export const MAX_SEQUENCE_COMPLEXITY = 100000;

// Bounds how many extra instances a Critical Shred chain can recurse through. Each further
// instance requires another crit, so the untruncated tail's probability is critChance^depth -
// for any realistic crit chance this is astronomically small well before depth 10 (e.g. 0.3^10 is
// about 6e-6), the same "exact enough" tradeoff as the app's existing 0.0005 display cutoff.
export const MAX_SHRED_DEPTH = 10;

export const FOCUS_DAMAGE_REDUCTION = 5;
export const DEF_FLOOR = 5; // Knocked Down / Stationary / Paralysis all reduce a target's DEF to this base before other flat penalties.
