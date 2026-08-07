export interface DamagePoint {
  readonly damage: number;
  readonly label: string;
  readonly probability: number;
}

/** One Focus-enabled attacker's own strategy block - the attacker's name as a heading, then one
 *  bullet per target its Focus actually reaches (Focus is one pool spent across the whole
 *  sequence, so a single attacker can have bullets for several targets - see
 *  `summarizeFocusStrategy` in `sequence.ts`). `bullets` is already fully formatted text (a "vs
 *  {target}: " prefix baked in whenever there's more than one target); the template just lists
 *  them. */
export interface FocusStrategyBlock {
  readonly attackerName: string;
  readonly bullets: string[];
}

/** One row in the "Step by step" list - one per actual ATTACK (shot), not per weapon, restoring
 *  continuous numbering across the whole sequence the way it read before weapons could fire more
 *  than once. See `SequenceShotResult` in `sequence.ts` for where `occursChance`/`hitChance`/
 *  `critChance`/`averageDamage` come from - `odds-calculator.ts`'s `shotRows` computed flattens
 *  `SequenceResult.steps[].shots[]` into this shape. */
export interface ShotRow {
  /** Unique `@for` track key - `${attack.id}-${shotIndex}`, since multiple rows share one `attack`. */
  readonly key: string;
  /** Continuous 1-based position across the WHOLE sequence, not reset per weapon. */
  readonly label: string;
  /** True for every weapon's own first shot (including the very first row overall) - the template
   *  renders a group header (`attackerName`/`typeEmoji`) right before this row when true, so every
   *  weapon's shots are visually grouped without breaking the continuous numbering. */
  readonly isNewWeapon: boolean;
  /** True only when `isNewWeapon` is also true AND the owning attacker differs from the previous
   *  weapon's - lets consecutive weapons from the SAME attacker share one header line (just the
   *  type icon repeats) instead of repeating the attacker's name for every one of its weapons. */
  readonly isNewAttacker: boolean;
  readonly attackerName: string;
  /** The weapon's own type emoji (🗡️/🏹/🪄) - see `TYPE_EMOJI` in `attack-row.model.ts`. */
  readonly typeEmoji: string;
  readonly occursChance: number;
  readonly hitChance: number;
  readonly critChance: number;
  readonly averageDamage: number;
}
