import { computeSequenceOdds } from './single-target';
import { RowInjection, SequencedAttack, SequenceResult, SequenceTarget, TargetSequenceResult } from './types';


/**
 * Runs `computeSequenceOdds` once per target, in order, chaining probability mass forward through
 * the target list - see the module doc comment's "Multiple targets" section for the full design.
 * Target 0 gets the default `available` schedule (100% fresh before row 0, i.e. today's exact
 * single-target starting condition). Each target only consumes the SLICE of `available` landing on
 * rows it's actually eligible for (`ownInjection`) - the REST (`passthrough`: mass on rows this
 * target was never even a candidate for) carries forward to the next target completely UNCHANGED,
 * not dropped - a weapon scoped away from this target might still be exactly what an EARLIER-ranked
 * weapon-eligible-but-target-ineligible row needs once it reaches a target it CAN hit. Target t+1's
 * own `available` is this passthrough UNION target t's own newly-destroyed mass
 * (`destroyChanceByShotsRemaining`, converted to a `RowInjection` exactly as before - row k+1 if t
 * died on row k's own last shot, row k itself for a genuine mid-volley resume). `onProgress`, if
 * given, is scaled so it advances smoothly across every target's own share of the overall work, not
 * just the current one's.
 */
export function computeMultiTargetSequenceOdds(
  attacks: SequencedAttack[],
  targets: SequenceTarget[],
  onProgress?: (fraction: number) => void
): TargetSequenceResult[] {
  const results: TargetSequenceResult[] = [];
  const rowCount = attacks.length;
  let available: RowInjection[] = [{ row: 0, shotsRemaining: 0, probability: 1 }];

  // Attacker Focus's cross-target downstream value: `downstreamValueAfter[i](row, shotsRemaining,
  // F)` = "destroy chance of targets[i..] onward, given the attacker enters target i at exactly
  // this `(row, shotsRemaining)` position (see `RowInjection`'s own doc comment for what that pair
  // means) with leftover Focus vector F" - built last-target-first so target i's own value function
  // already accounts for everything after it (see single-target.ts's `withAttackerFocusValue`, and
  // `SequenceOptions`'s own doc comment for why each target's own Attacker-Focus decisions need
  // this to avoid being only locally optimal).
  //
  // `row`/`shotsRemaining` are NOT optional detail here - an earlier version of this probe always
  // hypothesized "fresh at row 0", i.e. every one of this attacker's OWN weapons still fully
  // unconsumed, regardless of how much of the sequence a real earlier target would already have
  // eaten through by the time target i is actually reached. That's wildly optimistic for target 2+
  // (row 0 is only ever true for target 0), which systematically UNDERSTATED how much preserving
  // Focus is really worth: the hypothetical baseline already assumed a full fresh arsenal even at
  // F=0, so the computed MARGINAL value of an extra Focus point (the F=1-vs-F=0 delta this whole
  // mechanism runs on) came out far smaller than reality, in some cases wrongly favoring a marginal
  // local boost over preserving Focus for a later target that would otherwise get NOTHING at all.
  // Threaded into each target's REAL `computeSequenceOdds` call below so the actual displayed
  // results use the same value function this was built with.
  //
  // Memoized per level (one Map per i, captured by that level's own closure and shared across every
  // caller, including this reverse pass's own recursive calls into level i+1) so the total cost is
  // bounded by O(distinct (row, shotsRemaining, F) triples actually queried) x targets.length, not
  // exponential in the number of targets - see single-target.ts's own call sites for exactly which
  // `(row, shotsRemaining)` pairs are ever asked for (always the exact position a real cross-target
  // handoff would use, mirroring `computeMultiTargetSequenceOdds`'s own `nextInjection`
  // construction below). A no-op (never invoked) whenever no attacker has Focus active - the common
  // case pays nothing.
  const downstreamValueAfter: Array<(row: number, shotsRemaining: number, f: number[]) => number> = new Array(targets.length + 1);
  downstreamValueAfter[targets.length] = () => 0;
  for (let i = targets.length - 1; i >= 0; i--) {
    const rowActiveForI = attacks.map((atk) => !atk.eligibleTargetIndices || atk.eligibleTargetIndices.includes(i));
    const cache = new Map<string, number>();
    const next = downstreamValueAfter[i + 1];
    downstreamValueAfter[i] = (row: number, shotsRemaining: number, f: number[]) => {
      const key = `${row}|${shotsRemaining}|${f.join(',')}`;
      const cached = cache.get(key);
      if (cached !== undefined) return cached;
      const value = computeSequenceOdds(attacks, targets[i], undefined, {
        rowActive: rowActiveForI,
        injection: [{ row, shotsRemaining, probability: 1, attackerFocusRemaining: f }],
        attackerFocusDownstreamValue: next,
      }).finalDestroyChance;
      cache.set(key, value);
      return value;
    };
  }

  targets.forEach((target, targetIndex) => {
    const rowActive = attacks.map((atk) => !atk.eligibleTargetIndices || atk.eligibleTargetIndices.includes(targetIndex));
    // `row === rowCount` isn't a real configured row at all - it's Attacker Focus's own "every row
    // is already spent against an earlier target, but some attacker still has leftover Focus"
    // marker (see single-target.ts's `terminalBoughtLookups`/`postSequenceBuyingDestroyMass`).
    // `rowActive` has nothing to say about it (it's only ever indexed 0..rowCount-1), so it's routed
    // by hand: genuinely spendable Focus is a real potential engagement with THIS target (buying
    // more attacks), so it goes to `ownInjection`; a fragment with nothing left to spend (no Focus
    // at all, or every configured attacker's own slot already at 0) can never touch this target and
    // keeps flowing through untouched, exactly like every other never-eligible row already does.
    const hasSpendableFocus = (inj: RowInjection) => (inj.attackerFocusRemaining ?? []).some((f) => f > 0);
    let ownInjection = available.filter((inj) => (inj.row === rowCount ? hasSpendableFocus(inj) : rowActive[inj.row]));
    // Mass on a row this target was never even a candidate for - untouched by this target's own
    // computeSequenceOdds call (which only ever reports on rows in `rowActive`), so it has to be
    // carried forward here explicitly rather than re-derived from `result` below.
    const passthrough = available.filter((inj) => (inj.row === rowCount ? !hasSpendableFocus(inj) : !rowActive[inj.row]));

    // `available` only ever carries EXPLICIT injection entries forward - it has no notion of "100%
    // is implicitly available at every row nobody's claimed yet". That's invisible for target 0 (its
    // own first row IS row 0, exactly where the default entry sits) but breaks for a later target
    // whose own first eligible row is one no EARLIER-ranked target is also eligible for: nothing
    // upstream ever produces an `available` entry AT that row (there was never any reason to), so
    // `ownInjection` would otherwise see 0% there even though this target is unconditionally
    // guaranteed a fresh shot the moment the sequence reaches it - it has no rival that could ever
    // "hold" that row instead. Detect that case and top the row up to a full, unconditional 1 -
    // replacing (not adding to) whatever partial/coincidental mass the chain happened to carry there,
    // since an unrivaled row's access can never actually depend on any earlier target's fate.
    const firstEligibleRow = rowActive.indexOf(true);
    if (firstEligibleRow !== -1) {
      const eligibleForFirstRow = attacks[firstEligibleRow].eligibleTargetIndices;
      const hasEarlierRivalAtFirstRow = eligibleForFirstRow
        ? eligibleForFirstRow.some((idx) => idx < targetIndex)
        : targetIndex > 0; // unset eligibleTargetIndices = eligible for every target, earlier ones included
      if (!hasEarlierRivalAtFirstRow) {
        // Tops the row up to a full, unconditional 1 (see above) WITHOUT discarding whatever
        // `attackerFocusRemaining` breakdown the existing entries already carried: rescale each
        // matching entry proportionally so they sum to 1 instead of replacing them with one bare
        // entry - engagement probability doesn't depend on an earlier target's fate here (that's
        // the whole reason this top-up exists), but Attacker Focus's own remaining amount very much
        // still does (it's the attacker's own resource, spent across the whole sequence - see
        // single-target.ts's Attacker Focus section), so it must survive this rescale. Falls back
        // to the original bare `{probability: 1}` (implicitly config-fresh Focus) only when NOTHING
        // was tracked at this row at all - the case the comment above actually describes.
        const matching = ownInjection.filter((inj) => inj.row === firstEligibleRow && inj.shotsRemaining === 0);
        const matchingMass = matching.reduce((sum, inj) => sum + inj.probability, 0);
        const toppedUp: RowInjection[] =
          matchingMass > 0
            ? matching.map((inj) => ({ ...inj, probability: inj.probability / matchingMass }))
            : [{ row: firstEligibleRow, shotsRemaining: 0, probability: 1 }];
        ownInjection = [...ownInjection.filter((inj) => !(inj.row === firstEligibleRow && inj.shotsRemaining === 0)), ...toppedUp];
      }
    }

    // Total mass that ever gets a chance to be resolved against THIS target - see
    // `TargetSequenceResult.engagementChance`'s own doc comment.
    const engagementChance = ownInjection.reduce((sum, inj) => sum + inj.probability, 0);

    const result = computeSequenceOdds(
      attacks,
      target,
      onProgress ? (fraction) => onProgress((targetIndex + fraction) / targets.length) : undefined,
      { rowActive, injection: ownInjection, attackerFocusDownstreamValue: downstreamValueAfter[targetIndex + 1] }
    );

    // `computeSequenceOdds` computes each shot's own `occursChance` relative to ITS OWN incoming
    // mass (whatever `ownInjection` above sums to, i.e. `engagementChance`) - a correct, row-local
    // ratio in isolation (see `SequenceShotResult`'s own doc comment: conditional on "the weapon's
    // turn comes up"), but for a later target `engagementChance` is ALREADY a fraction of the true
    // original 1.0, so left as-is this ratio silently drops that outer fraction: a shot that only
    // ever fires in the rare branch where an earlier target died early would misleadingly read as
    // 100% ("guaranteed, given we got this far") rather than genuinely rare. `computeSequenceOdds`
    // is entirely linear in its own `injection` (nothing anywhere renormalizes - see the module doc
    // comment), so scaling every `occursChance` by `engagementChance` converts it back into a true
    // probability out of the original 1.0, exactly like `finalDestroyChance` already is - a no-op
    // whenever `engagementChance` is 1 (target 0, or any later target with no earlier rival).
    const rescaledResult: SequenceResult =
      engagementChance === 1
        ? result
        : {
            ...result,
            steps: result.steps.map((step) => ({
              ...step,
              shots: step.shots.map((shot) => ({ ...shot, occursChance: shot.occursChance * engagementChance })),
            })),
          };
    results.push({ result: rescaledResult, engagementChance });

    const nextInjection: RowInjection[] = [...passthrough];
    result.steps.forEach((step, k) => {
      // Iterates `destroyMassByShotsRemainingAndFocus` rather than `destroyChanceByShotsRemaining`
      // directly - the former always covers the exact same total mass (see its own doc comment),
      // just with the extra `attackerFocusRemaining` coordinate `RowInjection` now carries, so
      // Attacker Focus correctly persists into the next target instead of resetting (Focus is one
      // shared pool for the whole multi-target sequence - see single-target.ts's Attacker Focus
      // section). A no-Focus sequence sees `attackerFocusRemaining: []` on every entry here, an
      // exact no-op past `RowInjection`'s own "unset means start fresh" default.
      step.destroyMassByShotsRemainingAndFocus.forEach(({ shotsRemaining, attackerFocusRemaining, probability }) => {
        if (probability <= 0) return;
        // `shotsRemaining === 0` means THIS target died on row k's own LAST shot - row k's whole
        // volley is already spent, so the next target starts fresh at row k+1, not row k again.
        // `shotsRemaining > 0` means row k's weapon still owes shots - the next target resumes
        // WITHIN that same row (a genuine mid-volley handoff, `row: k` is correct there).
        if (shotsRemaining === 0) nextInjection.push({ row: k + 1, shotsRemaining: 0, probability, attackerFocusRemaining });
        else nextInjection.push({ row: k, shotsRemaining, probability, attackerFocusRemaining });
      });
    });
    // Mass destroyed by Attacker Focus buying MORE attacks after every configured row was already
    // spent (this target's own `row: rowCount` injection, above) - not tied to any step, so it isn't
    // covered by the loop above at all. Fed back in at the SAME `row: rowCount` marker, in case a
    // THIRD target also needs a shot at whatever Focus is still left after this one.
    result.postSequenceBuyingDestroyMass.forEach(({ attackerFocusRemaining, probability }) => {
      if (probability <= 0) return;
      nextInjection.push({ row: rowCount, shotsRemaining: 0, probability, attackerFocusRemaining });
    });
    available = nextInjection;
  });

  return results;
}

/**
 * "Chance to destroy every target" - the true JOINT probability, not simply the product of each
 * target's own (marginal) `finalDestroyChance`: two targets that share a weapon are correlated
 * (the same dice decide both of their fates, not independent draws), so naively multiplying their
 * marginals over- or under-counts depending on the correlation - see the module doc comment's
 * "Multiple targets" section for a worked counterexample of why independence can't be assumed here.
 *
 * Two targets that share NO weapon at all, transitively, are provably independent instead (their
 * own dice never overlap at all) - so this groups targets into CONNECTED COMPONENTS by shared
 * weapon eligibility and multiplies each component's own "everyone in it destroyed" probability
 * together, safe since different components can never correlate with each other.
 *
 * Within one component, the highest-ranked (last-processed) target's own `finalDestroyChance`
 * ALREADY equals that whole component's joint "everyone in it destroyed" probability, for the same
 * reason `computeMultiTargetSequenceOdds`'s own passthrough mechanism is exact: any mass reaching a
 * later target through a rivaled row structurally REQUIRES every earlier rival sharing that row to
 * have already died first (a row that's still active for an earlier-ranked, still-alive rival
 * always fully resolves against it - there's no "leftover, still-undecided" mass that skips past a
 * living rival and reaches someone else instead) - so by induction, a target with no unrivaled row
 * of its own already carries its whole chain's joint requirement forward inside its own single
 * number. This is exact for exactly the same cases `computeMultiTargetSequenceOdds` itself is exact
 * for (fully independent weapons; a single shared weapon, or one handing off to per-target
 * dedicated ones) - it inherits that same function's one documented approximation for a target with
 * BOTH an unrivaled row and a later row it shares with an earlier target.
 */
export function chanceToDestroyAllTargets(attacks: SequencedAttack[], results: TargetSequenceResult[]): number {
  const targetCount = results.length;
  const parent = Array.from({ length: targetCount }, (_, i) => i);
  function find(i: number): number {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  }
  function union(a: number, b: number): void {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[rootA] = rootB;
  }

  for (const atk of attacks) {
    const eligible = atk.eligibleTargetIndices ?? Array.from({ length: targetCount }, (_, i) => i);
    for (let k = 1; k < eligible.length; k++) union(eligible[0], eligible[k]);
  }

  const lastIndexByComponent = new Map<number, number>();
  for (let i = 0; i < targetCount; i++) {
    const root = find(i);
    lastIndexByComponent.set(root, Math.max(lastIndexByComponent.get(root) ?? -1, i));
  }

  let chance = 1;
  for (const lastIndex of lastIndexByComponent.values()) {
    chance *= results[lastIndex].result.finalDestroyChance;
  }
  return chance;
}
