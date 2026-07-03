import { Injectable } from '@angular/core';
import { AttackInput, AttackOdds, computeAttackOdds } from './attack-model';

/**
 * Thin injectable wrapper around the pure `computeAttackOdds` function.
 * The engine itself has zero Angular dependencies on purpose - this class
 * just gives components a conventional way to consume it via DI (and a
 * seam to add caching, saved profiles, etc. later without touching the math).
 */
@Injectable({ providedIn: 'root' })
export class OddsEngine {
  compute(input: AttackInput): AttackOdds {
    return computeAttackOdds(input);
  }
}
