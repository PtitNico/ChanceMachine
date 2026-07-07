/**
 * dice-pool.ts
 * ------------
 * Exact (non-Monte-Carlo) probability math for d6 dice pools, as used by
 * Warmachine/Hordes-style "roll 2d6 (+boosts) vs a target number" mechanics.
 *
 * Everything here works on the RAW DICE SUM (before adding MAT/RAT/POW etc.).
 * The caller adds the flat modifier and compares to a target number.
 *
 * Why exact enumeration instead of Monte Carlo?
 * Dice pools in this game are small (2-6 dice), so the full outcome space
 * (6^n <= 46656 for n=6) is trivial to enumerate exactly. That gives
 * deterministic, instant, no-flicker results instead of an approximation.
 */

export interface DicePoolOutcome {
  /** Sum of the dice that were actually kept (after any discard). */
  sum: number;
  /** True if at least two of the ROLLED dice (before discard) show the same
   *  face - this is the "critical" trigger in WM/H. */
  hasDouble: boolean;
  /** Probability of this exact outcome. */
  probability: number;
}

export interface DicePoolConfig {
  /** Total number of d6 rolled, including any boost dice. */
  diceCount: number;
  /** Optional: discard some dice before summing (e.g. an effect that forces
   *  you to discard the highest die). `highest` and `lowest` can both be set
   *  at once (some builds combine "discard lowest" and "discard highest" on
   *  the same roll). */
  discard?: {
    highest?: number;
    lowest?: number;
  };
  /** Jump the Shark: every rolled die showing a 1 is treated as a 6 instead,
   *  before discard/sum/double detection all happen. */
  treatOnesAsSixes?: boolean;
  /** Sanguine Fate: N extra d6 rolled alongside the pool. They're never part
   *  of the kept sum, but they DO count towards "double" detection for
   *  crits (rolling one of them the same as any other die in the pool
   *  still triggers a critical hit). */
  extraCritDice?: number;
}

const FACES = [1, 2, 3, 4, 5, 6];
const MAX_TOTAL_DICE = 8; // 6^8 ~= 1.68M tuples - far beyond anything this game produces, just a safety cap.

/**
 * Enumerates every ordered outcome of rolling `diceCount` d6 (plus any extra
 * crit-only dice), applies the optional discard rule, and aggregates
 * identical (sum, hasDouble) results.
 */
export function rollDicePool(config: DicePoolConfig): DicePoolOutcome[] {
  const { diceCount } = config;
  const extraCritDice = config.extraCritDice ?? 0;
  const totalDice = diceCount + extraCritDice;

  if (diceCount < 1) return [{ sum: 0, hasDouble: false, probability: 1 }];
  if (totalDice > MAX_TOTAL_DICE) {
    throw new Error(`diceCount=${totalDice} is unrealistically large for this game (cap: ${MAX_TOTAL_DICE})`);
  }

  const discardHighestCount = config.discard?.highest ?? 0;
  const discardLowestCount = config.discard?.lowest ?? 0;
  const treatOnesAsSixes = !!config.treatOnesAsSixes;
  const singleProb = 1 / 6;
  const totalOutcomes = Math.pow(6, totalDice);
  const perOutcomeProb = Math.pow(singleProb, totalDice);

  // Aggregate by a string key "sum|hasDouble" -> probability
  const agg = new Map<string, DicePoolOutcome>();

  // Iterate all 6^totalDice tuples via mixed-radix counting. The first
  // `diceCount` slots are the "real" pool (summed, discardable); any
  // remaining slots are extra crit-only dice (Sanguine Fate).
  const dice = new Array(totalDice).fill(0);
  for (let i = 0; i < totalOutcomes; i++) {
    let n = i;
    for (let d = 0; d < totalDice; d++) {
      let face = FACES[n % 6];
      if (treatOnesAsSixes && face === 1) face = 6;
      dice[d] = face;
      n = Math.floor(n / 6);
    }

    const hasDouble = detectDouble(dice);
    const pool = dice.slice(0, diceCount);
    const kept = applyDiscard(pool, discardHighestCount, discardLowestCount);
    const sum = kept.reduce((a, b) => a + b, 0);

    const key = `${sum}|${hasDouble}`;
    const existing = agg.get(key);
    if (existing) {
      existing.probability += perOutcomeProb;
    } else {
      agg.set(key, { sum, hasDouble, probability: perOutcomeProb });
    }
  }

  return [...agg.values()].sort((a, b) => a.sum - b.sum);
}

function detectDouble(dice: number[]): boolean {
  const seen = new Set<number>();
  for (const d of dice) {
    if (seen.has(d)) return true;
    seen.add(d);
  }
  return false;
}

/** Discards `lowestCount` of the lowest dice and `highestCount` of the highest - both can apply at once. */
function applyDiscard(dice: number[], highestCount: number, lowestCount: number): number[] {
  if (highestCount <= 0 && lowestCount <= 0) return dice;
  const sorted = [...dice].sort((a, b) => a - b);
  const end = Math.max(lowestCount, sorted.length - highestCount);
  return sorted.slice(lowestCount, end);
}

/**
 * Applies a "reroll the whole pool once" rule: outcomes flagged `isBad` are
 * rerolled once, and the new result is kept unconditionally. Models an
 * optimal "may reroll" ability: since a fresh reroll always follows the same
 * distribution as the original roll, only rerolling a roll you'd genuinely
 * want to replace (a miss, or a below-average damage roll) is never worse
 * than keeping a roll that already clears it.
 *
 * Correctly tracks (sum, hasDouble) jointly through the reroll: a kept
 * outcome keeps its own hasDouble, and the rerolled mass redistributes
 * across the FULL original distribution (including its hasDouble values) -
 * a reroll can still crit.
 */
export function rerollPoolOnceIf(
  outcomes: DicePoolOutcome[],
  isBad: (outcome: DicePoolOutcome) => boolean
): DicePoolOutcome[] {
  const qBad = outcomes.filter(isBad).reduce((acc, o) => acc + o.probability, 0);

  if (qBad === 0) return outcomes;

  const agg = new Map<string, DicePoolOutcome>();
  const add = (sum: number, hasDouble: boolean, probability: number) => {
    const key = `${sum}|${hasDouble}`;
    const existing = agg.get(key);
    if (existing) {
      existing.probability += probability;
    } else {
      agg.set(key, { sum, hasDouble, probability });
    }
  };

  for (const o of outcomes) {
    if (!isBad(o)) {
      add(o.sum, o.hasDouble, o.probability); // kept as rolled
    }
    add(o.sum, o.hasDouble, qBad * o.probability); // this outcome's share of the rerolled mass
  }

  return [...agg.values()].sort((a, b) => a.sum - b.sum);
}

/** Convenience wrapper for the common "reroll if sum is below N" case (e.g. a below-average damage roll). */
export function rerollPoolOnceIfBelow(outcomes: DicePoolOutcome[], threshold: number): DicePoolOutcome[] {
  return rerollPoolOnceIf(outcomes, (o) => o.sum < threshold);
}

/** Utility: total probability that sum >= threshold. */
export function probabilityAtLeast(outcomes: DicePoolOutcome[], threshold: number): number {
  return outcomes
    .filter((o) => o.sum >= threshold)
    .reduce((acc, o) => acc + o.probability, 0);
}

/** Utility: total probability that hasDouble is true. */
export function probabilityOfDouble(outcomes: DicePoolOutcome[]): number {
  return outcomes.filter((o) => o.hasDouble).reduce((acc, o) => acc + o.probability, 0);
}
