import { Injectable, signal } from '@angular/core';
import { SequencedAttack, SequenceResult, SequenceTarget } from './sequence';
import { SequenceWorkerRequest, SequenceWorkerResponse } from './sequence.worker';

const EMPTY_RESULT: SequenceResult = { steps: [], finalDestroyChance: 0, survivalDistribution: [] };

/** How long a computation must still be running before `calculating` flips on - short recomputes
 *  (the overwhelming majority) never show the indicator at all, avoiding a flash on every keystroke. */
const SHOW_CALCULATING_DELAY_MS = 350;

/**
 * Runs `computeSequenceOdds` in a Web Worker (`sequence.worker.ts`) instead of on the main thread -
 * a slow sequence can take several seconds even after the engine's own lazy value-table
 * optimization (see sequence.ts's module doc comment), and JS being single-threaded means a
 * synchronous call of that length would freeze the whole tab, no repaint, no animation, until it
 * returned. Exposes plain signals (`result`/`progress`/`calculating`) rather than a callback/Promise
 * API - this app is signals-based throughout with no RxJS usage, and a Promise doesn't fit well here
 * anyway: a computation can be superseded mid-flight, and a Promise can't be "un-resolved".
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

  private readonly _result = signal<SequenceResult>(EMPTY_RESULT);
  private readonly _progress = signal<number | null>(null);
  private readonly _calculating = signal(false);

  readonly result = this._result.asReadonly();
  /** 0-1, or `null` whenever nothing is in flight. See `computeSequenceOdds`'s own `onProgress` doc
   *  comment - this can jump unevenly rather than advancing smoothly. */
  readonly progress = this._progress.asReadonly();
  /** True only once a computation has been running for `SHOW_CALCULATING_DELAY_MS` - never flips on
   *  for a fast (the common case) recompute. */
  readonly calculating = this._calculating.asReadonly();

  computeSequence(attacks: SequencedAttack[], target: SequenceTarget): void {
    this.cancelInFlight();

    this._progress.set(0);
    this.showTimer = setTimeout(() => this._calculating.set(true), SHOW_CALCULATING_DELAY_MS);

    const worker = new Worker(new URL('./sequence.worker', import.meta.url));
    this.worker = worker;

    worker.onmessage = ({ data }: MessageEvent<SequenceWorkerResponse>) => {
      switch (data.type) {
        case 'progress':
          this._progress.set(data.fraction);
          break;
        case 'result':
          this._result.set(data.result);
          this.settle();
          break;
        case 'error':
          console.error('Sequence computation failed:', data.message);
          this.settle();
          break;
      }
    };
    worker.onerror = (event) => {
      console.error('Sequence worker crashed:', event.message);
      this.settle();
    };

    worker.postMessage({ type: 'compute', attacks, target } satisfies SequenceWorkerRequest);
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
