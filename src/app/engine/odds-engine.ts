import { Injectable, signal } from '@angular/core';
import { estimateSequenceComplexity, MAX_SEQUENCE_COMPLEXITY, SequencedAttack, SequenceTarget, TargetSequenceResult } from './sequence';
import { SequenceWorkerRequest, SequenceWorkerResponse } from './sequence.worker';

const EMPTY_RESULTS: TargetSequenceResult[] = [];

/** How long a computation must still be running before `calculating` flips on - short recomputes
 *  (the overwhelming majority) never show the indicator at all, avoiding a flash on every keystroke. */
const SHOW_CALCULATING_DELAY_MS = 350;

/**
 * Runs `computeSequenceOdds` in a Web Worker (`sequence.worker.ts`) instead of on the main thread -
 * a slow sequence can take several seconds even after the engine's own lazy value-table
 * optimization (see sequence.ts's module doc comment), and JS being single-threaded means a
 * synchronous call of that length would freeze the whole tab, no repaint, no animation, until it
 * returned. Exposes plain signals (`result`/`progress`/`calculating`/`error`/`cancelled`/`slow`)
 * rather than a callback/Promise API - this app is signals-based throughout with no RxJS usage, and a
 * Promise doesn't fit well here anyway: a computation can be superseded mid-flight, and a Promise
 * can't be "un-resolved".
 *
 * `computeSequence` always fully cancels whatever's currently running (`worker.terminate()`) before
 * starting a new one, rather than letting a stale computation finish and just discarding its result
 * - terminating is immediate and spinning up a fresh worker costs single-digit milliseconds, a
 * rounding error next to the multi-second computations this class exists for, so a burst of rapid
 * input changes (typing, dragging) costs at most one cheap worker respawn per change, never a pile
 * of full computations queuing up behind each other.
 */
@Injectable({ providedIn: 'root' })
export class OddsEngine {
  private worker: Worker | null = null;
  private showTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly _result = signal<TargetSequenceResult[]>(EMPTY_RESULTS);
  private readonly _progress = signal<number | null>(null);
  private readonly _calculating = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _cancelled = signal(false);
  private readonly _slow = signal(false);

  /** One entry per target, in order - see `computeMultiTargetSequenceOdds`. Stays at whatever it
   *  last held (rather than clearing) once `error` is set - see `error`'s own doc comment for why
   *  the UI shouldn't treat a failed recompute as "no results". */
  readonly result = this._result.asReadonly();
  /** 0-1, or `null` whenever nothing is in flight. See `computeSequenceOdds`'s own `onProgress` doc
   *  comment - this can jump unevenly rather than advancing smoothly. */
  readonly progress = this._progress.asReadonly();
  /** True only once a computation has been running for `SHOW_CALCULATING_DELAY_MS` - never flips on
   *  for a fast (the common case) recompute. */
  readonly calculating = this._calculating.asReadonly();
  /** The message from the most recent computation's `'error'`/`onerror` outcome, or `null` once a
   *  later computation has started or succeeded. `sequence.ts` still throws on a few individually
   *  unrealistic field values (e.g. `attackerFocus` above `MAX_RESOURCE_POINTS`) - none of these are
   *  reachable through the UI's own inputs today (every relevant `<select>` is already range-limited
   *  to a valid value), so in practice this exists mainly for `worker.onerror`'s genuine crash case
   *  and future-proofing, not a live day-to-day path. Before this existed, a failure here surfaced as
   *  nothing but a `console.error` - `calculating` never even flipped on (a throw is near-instant,
   *  well under `SHOW_CALCULATING_DELAY_MS`) and `result` stayed frozen at whatever the last
   *  SUCCESSFUL computation produced - indistinguishable, from the player's side, from the app
   *  having silently frozen: no indicator, and no further input change could ever fix it while the
   *  same failing combination stayed configured. (This is exactly what originally happened with the
   *  old flat `MAX_FOCUS_ATTACKERS` attacker-count cap - since replaced by the purely advisory
   *  `slow` signal below, not a throw at all anymore.) */
  readonly error = this._error.asReadonly();
  /** True once the player has manually cancelled a still-running computation via `cancel()` - reset
   *  to `false` at the start of the next `computeSequence` call (input change), same lifecycle as
   *  `error`. There's no hard ceiling on how long a computation can take at all anymore (see `slow`
   *  below) - `cancel` is the escape hatch for whenever a computation turns out to be slower than the
   *  player is willing to wait for, rather than trying to guess that tolerance in advance. Kept
   *  distinct from `error` (not reused as a message) since being cancelled is a deliberate player
   *  action, not a failure - the UI shows it with its own, calmer styling and a Retry action (see
   *  `OddsCalculator.onRetry`) rather than `error`'s "fix your configuration" framing. */
  readonly cancelled = this._cancelled.asReadonly();
  /** True whenever the CURRENT computation's own `estimateSequenceComplexity` (any target) exceeds
   *  `MAX_SEQUENCE_COMPLEXITY` - computed synchronously on the main thread, before the worker is even
   *  spun up (a cheap O(1) multiplication, unlike the computation it's estimating the cost of), so
   *  it's available from the very first render of the "Calculating" overlay rather than needing to
   *  wait and see. Purely advisory: `sequence.ts` itself no longer rejects any configuration for
   *  being "too complex" (a hard cap here was tried and explicitly rejected - a player's own device
   *  may well handle far more than this estimate's absolute number suggests, and there's no way to
   *  know that in advance) - this only drives `ResultsPanel`'s "this might take a long time" hint
   *  alongside `calculating`, leaving the actual judgment call (wait it out, Cancel, or change the
   *  inputs) to the player. See `MAX_SEQUENCE_COMPLEXITY`'s own doc comment (constants.ts) for the
   *  full calibration history. */
  readonly slow = this._slow.asReadonly();

  computeSequence(attacks: SequencedAttack[], targets: SequenceTarget[]): void {
    this.cancelInFlight();

    this._progress.set(0);
    this._error.set(null);
    this._cancelled.set(false);
    this._slow.set(targets.some((target) => estimateSequenceComplexity(attacks, target) > MAX_SEQUENCE_COMPLEXITY));
    this.showTimer = setTimeout(() => this._calculating.set(true), SHOW_CALCULATING_DELAY_MS);

    const worker = new Worker(new URL('./sequence.worker', import.meta.url));
    this.worker = worker;

    worker.onmessage = ({ data }: MessageEvent<SequenceWorkerResponse>) => {
      switch (data.type) {
        case 'progress':
          this._progress.set(data.fraction);
          break;
        case 'result':
          this._result.set(data.results);
          this.settle();
          break;
        case 'error':
          console.error('Sequence computation failed:', data.message);
          this._error.set(data.message);
          this.settle();
          break;
      }
    };
    worker.onerror = (event) => {
      console.error('Sequence worker crashed:', event.message);
      this._error.set(event.message || 'The calculation crashed unexpectedly.');
      this.settle();
    };

    worker.postMessage({ type: 'compute', attacks, targets } satisfies SequenceWorkerRequest);
  }

  /** Aborts whatever's currently running WITHOUT starting a new computation - unlike every other way
   *  a computation ends (success, error, or being superseded by the next input change), this is a
   *  deliberate "stop, I don't want to wait for this" from the player. A no-op if nothing is in
   *  flight. Leaves `result` at whatever it last held - only the next input change (or the Retry
   *  action, `OddsCalculator.onRetry`, calling `computeSequence` again directly with unchanged
   *  inputs) can start a fresh computation from here. */
  cancel(): void {
    if (!this.worker) return;
    this.cancelInFlight();
    this._progress.set(null);
    this._calculating.set(false);
    this._cancelled.set(true);
  }

  private cancelInFlight(): void {
    if (this.showTimer !== null) clearTimeout(this.showTimer);
    this.showTimer = null;
    this.worker?.terminate();
    this.worker = null;
  }

  /** Whatever finished (success, error, or superseded by `cancelInFlight`) - clears the pending
   *  "show the indicator" timer and turns it back off, and forgets the finished worker. */
  private settle(): void {
    if (this.showTimer !== null) clearTimeout(this.showTimer);
    this.showTimer = null;
    this._calculating.set(false);
    this._progress.set(null);
    this.worker = null;
  }
}
