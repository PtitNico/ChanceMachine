import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { OddsEngine } from '../engine/odds-engine';
import { SequencedAttack } from '../engine/sequence';
import { AttackRow, cloneAttackRow, createAttackRow, toSequencedAttack } from './attack-row.model';
import { AttackRowComponent } from './attack-row/attack-row';
import { DamagePoint } from './details-dialog/details-dialog.model';
import { DetailsDialog } from './details-dialog/details-dialog';
import { EffectsDialog } from './effects-dialog/effects-dialog';
import { ResultsPanel } from './results-panel/results-panel';
import { TargetPanel } from './target-panel/target-panel';
import { TargetState, createTargetState } from './target-panel/target-panel.model';

@Component({
  selector: 'app-odds-calculator',
  standalone: true,
  imports: [TargetPanel, AttackRowComponent, ResultsPanel, EffectsDialog, DetailsDialog],
  templateUrl: './odds-calculator.html',
  // Shared partials first, this component's own file last: `.console--attacks` here must
  // win its `flex-shrink` tie-break against shared/section.css's `.console` (equal
  // specificity, same element - both classes are on the Attack sequence <section>).
  styleUrls: ['./shared/section.css', './odds-calculator.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OddsCalculator {
  private readonly engine = inject(OddsEngine);

  // --- Target (shared across the whole sequence) ---
  protected readonly target: TargetState = createTargetState();

  // --- Attack sequence ---
  protected readonly rows = signal<AttackRow[]>([createAttackRow()]);

  private readonly sequencedAttacks = computed<SequencedAttack[]>(() =>
    this.rows().map((row, i) => toSequencedAttack(row, i))
  );

  private static readonly MAX_RESOURCE_POINTS = 10;

  private static clampResourcePoints(value: number): number {
    return Math.max(0, Math.min(OddsCalculator.MAX_RESOURCE_POINTS, Math.floor(value || 0)));
  }

  /** Recomputed automatically whenever any row or target input changes. */
  protected readonly sequence = computed(() =>
    this.engine.computeSequence(this.sequencedAttacks(), {
      def: this.target.def(),
      arm: this.target.arm(),
      boxes: this.target.boxes(),
      tough: this.target.tough(),
      focusPoints: OddsCalculator.clampResourcePoints(this.target.focus()),
      furyPoints: OddsCalculator.clampResourcePoints(this.target.fury()),
    })
  );

  /** Total damage dealt over the whole sequence: `survivalDistribution` (boxes remaining if
   *  the target survives) converted to `boxesInitial - boxes`, plus one aggregated bucket for
   *  every outcome that destroys the target (>= boxesInitial damage, labelled "N+") - since a
   *  destroyed target's exact overkill isn't tracked, only that it reached or exceeded its box count. */
  protected readonly damageDistributionPoints = computed<DamagePoint[]>(() => {
    const { survivalDistribution, finalDestroyChance } = this.sequence();
    const boxesInitial = this.target.boxes();

    const points: DamagePoint[] = survivalDistribution.map((p) => ({
      damage: boxesInitial - p.boxes,
      label: `${boxesInitial - p.boxes}`,
      probability: p.probability,
    }));
    if (finalDestroyChance > 0) {
      points.push({ damage: boxesInitial, label: `${boxesInitial}+`, probability: finalDestroyChance });
    }

    return points.filter((p) => p.probability >= 0.0005).sort((a, b) => a.damage - b.damage);
  });

  protected readonly maxDamageProbability = computed(() =>
    Math.max(...this.damageDistributionPoints().map((p) => p.probability), 0.0001)
  );

  /** Copies the previous attack by default - most sequences chain similar attacks. */
  protected addAttack(): void {
    this.rows.update((rows) => {
      const last = rows.at(-1);
      return [...rows, last ? cloneAttackRow(last) : createAttackRow()];
    });
  }

  protected removeAttack(id: string): void {
    this.rows.update((rows) => (rows.length > 1 ? rows.filter((r) => r.id !== id) : rows));
  }
}
