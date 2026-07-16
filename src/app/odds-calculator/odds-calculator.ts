import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { OddsEngine } from '../engine/odds-engine';
import { SequencedAttack } from '../engine/sequence';
import { AboutDialog } from './about-dialog/about-dialog';
import { AppMenu } from './app-menu/app-menu';
import { AttackRow, cloneAttackRow, createAttackRow, toSequencedAttack } from './attack-row.model';
import { AttackRowComponent } from './attack-row/attack-row';
import { ChangelogDialog } from './changelog-dialog/changelog-dialog';
import { DamagePoint } from './details-dialog/details-dialog.model';
import { DetailsDialog } from './details-dialog/details-dialog';
import { EffectsDialog } from './effects-dialog/effects-dialog';
import { FeedbackDialog } from './feedback-dialog/feedback-dialog';
import { ResultsPanel } from './results-panel/results-panel';
import { TargetPanel } from './target-panel/target-panel';
import {
  TargetState,
  createTargetState,
  effectiveCarapace,
  effectiveToughKind,
  effectiveUnyielding,
  resetTargetFully,
  shieldArmBonus,
  spellArmBonus,
  spellArmBonusPostDispel,
  spellDefBonus,
  spellDefBonusPostDispel,
} from './target-panel/target-panel.model';
import { TargetProfileDialog } from './target-profile-dialog/target-profile-dialog';

@Component({
  selector: 'app-odds-calculator',
  standalone: true,
  imports: [
    TargetPanel,
    AttackRowComponent,
    ResultsPanel,
    EffectsDialog,
    DetailsDialog,
    TargetProfileDialog,
    AppMenu,
    AboutDialog,
    ChangelogDialog,
    FeedbackDialog,
  ],
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
      tough: effectiveToughKind(this.target) === 'tough',
      toughSteady: effectiveToughKind(this.target) === 'toughSteady',
      toughPostDispel: this.target.toughKind() === 'tough',
      toughSteadyPostDispel: this.target.toughKind() === 'toughSteady',
      focusPoints: OddsCalculator.clampResourcePoints(
        this.target.resourceKind() === 'focus' ? this.target.resourcePoints() : 0
      ),
      furyPoints: OddsCalculator.clampResourcePoints(
        this.target.resourceKind() === 'fury' ? this.target.resourcePoints() : 0
      ),
      shieldArmBonus: shieldArmBonus(this.target),
      spellArmBonus: spellArmBonus(this.target),
      spellArmBonusPostDispel: spellArmBonusPostDispel(this.target),
      defBonus: spellDefBonus(this.target),
      defBonusPostDispel: spellDefBonusPostDispel(this.target),
      unyielding: effectiveUnyielding(this.target),
      unyieldingPostDispel: this.target.unyielding(),
      carapace: effectiveCarapace(this.target),
      carapacePostDispel: this.target.carapace(),
      rapidHealing: this.target.rapidHealing(),
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

  /** Hamburger menu's "Reset": wipes the target's profile AND its DEF/ARM/Boxes (unlike the
   *  Target profile pop-up's own Reset, which only touches the profile), and collapses the
   *  attack sequence back down to a single default row. */
  protected resetAll(): void {
    resetTargetFully(this.target);
    this.rows.set([createAttackRow()]);
  }
}
