/**
 * sequence.worker.ts
 * -------------------
 * Runs `computeSequenceOdds` off the main thread, so a slow sequence (a lot of Focus/Fury/Knowledge
 * of the Damned resource points combined with Puppet Master/Rate of Fire/Critical Shred can take
 * several seconds even after the engine's own lazy value-table optimization - see sequence.ts's
 * module doc comment) never freezes the tab. `sequence.ts` only imports from `attack-model.ts`,
 * which only imports from `dice-pool.ts`, which has no imports at all - the whole chain is
 * framework-free, so it bundles into a worker with no Angular runtime pulled in. `SequencedAttack`/
 * `SequenceTarget` are plain data (primitives/strings/optional booleans/enums), safe to pass through
 * `postMessage`'s structured clone.
 *
 * No `requestId` in the protocol: `odds-engine.ts` never sends more than one `compute` message to a
 * given worker instance - a NEW request always terminates whatever worker is currently running and
 * spins up a fresh one, rather than queuing a second message on the same worker (see its own doc
 * comment for why).
 */
import { SequencedAttack, SequenceResult, SequenceTarget, computeSequenceOdds } from './sequence';

export interface SequenceWorkerRequest {
  type: 'compute';
  attacks: SequencedAttack[];
  target: SequenceTarget;
}

export type SequenceWorkerResponse =
  | { type: 'progress'; fraction: number }
  | { type: 'result'; result: SequenceResult }
  | { type: 'error'; message: string };

addEventListener('message', ({ data }: MessageEvent<SequenceWorkerRequest>) => {
  if (data.type !== 'compute') return;
  try {
    const result = computeSequenceOdds(data.attacks, data.target, (fraction) =>
      postMessage({ type: 'progress', fraction } satisfies SequenceWorkerResponse)
    );
    postMessage({ type: 'result', result } satisfies SequenceWorkerResponse);
  } catch (err) {
    postMessage({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    } satisfies SequenceWorkerResponse);
  }
});
