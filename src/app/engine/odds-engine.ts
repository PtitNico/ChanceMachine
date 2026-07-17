import { Injectable } from '@angular/core';
import { computeSequenceOdds, SequencedAttack, SequenceResult, SequenceTarget } from './sequence';

/**
 * Thin injectable wrapper around the pure engine function. The engine
 * itself has zero Angular dependencies on purpose - this class just gives
 * components a conventional way to consume it via DI (and a seam to add
 * caching, saved profiles, etc. later without touching the math).
 */
@Injectable({ providedIn: 'root' })
export class OddsEngine {
  computeSequence(attacks: SequencedAttack[], target: SequenceTarget): SequenceResult {
    return computeSequenceOdds(attacks, target);
  }
}
