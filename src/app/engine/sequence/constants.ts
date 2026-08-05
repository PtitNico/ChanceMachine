export const MAX_RESOURCE_POINTS = 10; // far beyond any Warmachine/Hordes caster's focus/fury stat; guards the value-table size.

// Scapegoats are mechanically capped at 4 per the model - a genuinely smaller cap than every other
// resource here, not a tightened version of MAX_RESOURCE_POINTS.
export const MAX_SCAPEGOATS = 4;

// Caps how many DISTINCT attackers can have Puppet Master active at once - the mask dimension
// grows as 2^(this many), same guard-rail spirit as MAX_RESOURCE_POINTS above. Realistically 0-2
// in any sequence; this just bounds the pathological case.
export const MAX_PM_ATTACKERS = 8;

// Bounds how many extra instances a Critical Shred chain can recurse through. Each further
// instance requires another crit, so the untruncated tail's probability is critChance^depth -
// for any realistic crit chance this is astronomically small well before depth 10 (e.g. 0.3^10 is
// about 6e-6), the same "exact enough" tradeoff as the app's existing 0.0005 display cutoff.
export const MAX_SHRED_DEPTH = 10;

export const FOCUS_DAMAGE_REDUCTION = 5;
export const DEF_FLOOR = 5; // Knocked Down / Stationary / Paralysis all reduce a target's DEF to this base before other flat penalties.
