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
   *  you to discard the highest die). */
  discard?: {
    count: number;
    mode: 'highest' | 'lowest';
  };
}

const FACES = [1, 2, 3, 4, 5, 6];

/**
 * Enumerates every ordered outcome of rolling `diceCount` d6, applies the
 * optional discard rule, and aggregates identical (sum, hasDouble) results.
 *
 * Safety cap: 8 dice (6^8 ~= 1.68M tuples) is already far beyond anything
 * this game produces (boosted rolls rarely exceed 4-5 dice); the cap just
 * protects against an accidental huge input from the UI.
 */
export function rollDicePool(config: DicePoolConfig): DicePoolOutcome[] {
  const { diceCount } = config;
  if (diceCount < 1) return [{ sum: 0, hasDouble: false, probability: 1 }];
  if (diceCount > 8) {
    throw new Error(`diceCount=${diceCount} is unrealistically large for this game (cap: 8)`);
  }

  const discardCount = config.discard?.count ?? 0;
  const discardHighest = config.discard?.mode === 'highest';
  const singleProb = 1 / 6;
  const totalOutcomes = Math.pow(6, diceCount);
  const perOutcomeProb = Math.pow(singleProb, diceCount);

  // Aggregate by a string key "sum|hasDouble" -> probability
  const agg = new Map<string, DicePoolOutcome>();

  // Iterate all 6^diceCount tuples via mixed-radix counting (fast enough:
  // worst case 6^8 ~ 1.68M iterations, well under a second in Node/V8).
  const dice = new Array(diceCount).fill(0);
  for (let i = 0; i < totalOutcomes; i++) {
    // decode i into `diceCount` base-6 digits -> face values
    let n = i;
    for (let d = 0; d < diceCount; d++) {
      dice[d] = FACES[n % 6];
      n = Math.floor(n / 6);
    }

    const hasDouble = detectDouble(dice);
    const kept = applyDiscard(dice, discardCount, discardHighest);
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

function applyDiscard(dice: number[], count: number, discardHighest: boolean): number[] {
  if (count <= 0) return dice;
  const sorted = [...dice].sort((a, b) => a - b);
  return discardHighest ? sorted.slice(0, sorted.length - count) : sorted.slice(count);
}

/**
 * Applies a "reroll the whole pool once" rule: if the dice sum is below
 * `threshold`, the pool is rerolled once and the new result is kept
 * unconditionally (models a player who always rerolls a bad roll once,
 * which is how most WM/H rerolls work in practice).
 *
 * Simplification: this operates on the sum-only distribution, so
 * `hasDouble` correlation with the reroll is not tracked (crit chance on a
 * rerolled attack is computed separately if needed). Good enough for
 * accurate hit/damage-threshold math, which is 95% of what people check.
 */
export function rerollPoolOnceIfBelow(
  outcomes: DicePoolOutcome[],
  threshold: number
): DicePoolOutcome[] {
  const qBelow = outcomes
    .filter((o) => o.sum < threshold)
    .reduce((acc, o) => acc + o.probability, 0);

  if (qBelow === 0) return outcomes;

  const bySum = new Map<number, number>();
  for (const o of outcomes) {
    const kept = o.sum >= threshold ? o.probability : 0;
    const rerolled = qBelow * o.probability;
    bySum.set(o.sum, (bySum.get(o.sum) ?? 0) + kept + rerolled);
  }

  return [...bySum.entries()]
    .map(([sum, probability]) => ({ sum, hasDouble: false, probability }))
    .sort((a, b) => a.sum - b.sum);
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
