export const MAX_RESOURCE_POINTS = 10; // far beyond any Warmachine/Hordes caster's focus/fury stat; guards the value-table size.

// Scapegoats are mechanically capped at 4 per the model - a genuinely smaller cap than every other
// resource here, not a tightened version of MAX_RESOURCE_POINTS.
export const MAX_SCAPEGOATS = 4;

// Caps how many DISTINCT attackers can have Puppet Master active at once - the mask dimension
// grows as 2^(this many), same guard-rail spirit as MAX_RESOURCE_POINTS above. Realistically 0-2
// in any sequence; this just bounds the pathological case.
export const MAX_PM_ATTACKERS = 8;

// Caps how many DISTINCT attackers can have Focus active at once. Attacker Focus is Map-key-folded
// exactly like Puppet Master (see single-target.ts's `tableKey`), but each attacker's own slot
// ranges over 0-10 (not a single bit like Puppet Master's mask) - N focus-enabled attackers
// multiply reachable states by up to 11^N, not 2^N, so this cap is deliberately much tighter than
// MAX_PM_ATTACKERS: 11^2 = 121 is the same rough order of magnitude as Puppet Master's own worst
// case of 2^8 = 256. See the module doc comment's Attacker Focus section.
export const MAX_FOCUS_ATTACKERS = 2;

// Bounds how many extra instances a Critical Shred chain can recurse through. Each further
// instance requires another crit, so the untruncated tail's probability is critChance^depth -
// for any realistic crit chance this is astronomically small well before depth 10 (e.g. 0.3^10 is
// about 6e-6), the same "exact enough" tradeoff as the app's existing 0.0005 display cutoff.
export const MAX_SHRED_DEPTH = 10;

export const FOCUS_DAMAGE_REDUCTION = 5;
export const DEF_FLOOR = 5; // Knocked Down / Stationary / Paralysis all reduce a target's DEF to this base before other flat penalties.
