import { CdkDrag, CdkDragDrop, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { OddsEngine } from '../engine/odds-engine';
import { SequencedAttack, SequenceTarget } from '../engine/sequence';
import { AboutDialog } from './about-dialog/about-dialog';
import { AppMenu } from './app-menu/app-menu';
import { AttackEditDialog } from './attack-edit-dialog/attack-edit-dialog';
import { toSequencedAttack } from './attack-row.model';
import { AttackerCard } from './attacker-card/attacker-card';
import { AttackerRulesDialog } from './attacker-rules-dialog/attacker-rules-dialog';
import { Attacker, addAttackTo, attackerDisplayName, createAttacker, removeAttackFrom, statFor } from './attacker.model';
import { ChangelogDialog } from './changelog-dialog/changelog-dialog';
import { DamagePoint } from './details-dialog/details-dialog.model';
import { DetailsDialog } from './details-dialog/details-dialog';
import { FeedbackDialog } from './feedback-dialog/feedback-dialog';
import { PwaInstallBanner } from './pwa-install-banner/pwa-install-banner';
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
    CdkDropList,
    CdkDrag,
    TargetPanel,
    AttackerCard,
    ResultsPanel,
    AttackEditDialog,
    AttackerRulesDialog,
    DetailsDialog,
    TargetProfileDialog,
    AppMenu,
    AboutDialog,
    ChangelogDialog,
    FeedbackDialog,
    PwaInstallBanner,
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

  // --- Attack sequence, grouped by attacker ---
  protected readonly attackers = signal<Attacker[]>([createAttacker()]);

  /** Attacks still resolve as ONE flat ordered sequence for the engine, regardless of which
   *  attacker owns them - `stat`/`attackerName` are no longer the row's own values (see
   *  attacker.model.ts), so they're resolved here from the row's parent attacker. `attackerIndex`
   *  (this loop's own index, not the display name) is Puppet Master's stable grouping key - see
   *  `sequence.ts`'s `SequencedAttack` doc comment for why `attackerName` can't be used for that. */
  private readonly sequencedAttacks = computed<SequencedAttack[]>(() => {
    const result: SequencedAttack[] = [];
    this.attackers().forEach((attacker, attackerIndex) => {
      const name = attackerDisplayName(attacker, attackerIndex);
      for (const row of attacker.attacks()) {
        result.push(toSequencedAttack(row, result.length, statFor(attacker, row.type()), name, attackerIndex, attacker.puppetMaster()));
      }
    });
    return result;
  });

  private static readonly MAX_RESOURCE_POINTS = 10;
  // Scapegoats are capped lower than every other resource here - see sequence.ts's MAX_SCAPEGOATS.
  private static readonly MAX_SCAPEGOATS = 4;

  private static clampToCap(value: number, cap: number): number {
    return Math.max(0, Math.min(cap, Math.floor(value || 0)));
  }

  private static clampResourcePoints(value: number): number {
    return OddsCalculator.clampToCap(value, OddsCalculator.MAX_RESOURCE_POINTS);
  }

  /** Recomputed automatically whenever any target input changes. */
  private readonly sequenceTarget = computed<SequenceTarget>(() => ({
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
    offensiveKnowledgeOfTheDamned: OddsCalculator.clampResourcePoints(this.target.offensiveKnowledgeOfTheDamned()),
    defensiveKnowledgeOfTheDamned: OddsCalculator.clampResourcePoints(this.target.defensiveKnowledgeOfTheDamned()),
    shieldGuards: OddsCalculator.clampResourcePoints(this.target.shieldGuards()),
    scapegoats: OddsCalculator.clampToCap(this.target.scapegoats(), OddsCalculator.MAX_SCAPEGOATS),
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
  }));

  /** `OddsEngine` runs the actual computation in a Web Worker (see its own doc comment) - this
   *  effect just kicks off a new run whenever the inputs change; the result/progress/calculating
   *  signals below are read straight from the engine, not held here. */
  constructor() {
    effect(() => {
      this.engine.computeSequence(this.sequencedAttacks(), this.sequenceTarget());
    });
  }

  protected readonly sequence = this.engine.result;
  protected readonly calculating = this.engine.calculating;
  protected readonly progress = this.engine.progress;

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

  protected onAddAttacker(): void {
    this.attackers.update((list) => [...list, createAttacker()]);
  }

  /** Reorders attackers by dragging their card's handle - doesn't touch which attacks belong to
   *  which attacker, just the order attackers (and so their attacks) resolve in. */
  protected onAttackerDrop(event: CdkDragDrop<Attacker[]>): void {
    const reordered = [...this.attackers()];
    moveItemInArray(reordered, event.previousIndex, event.currentIndex);
    this.attackers.set(reordered);
  }

  /** An attacker can't be removed while it's the only one - mirrors the same "always >=1" rule
   *  the sequence has always had, just moved up one level now that attacks are grouped. */
  protected onRemoveAttacker(attackerId: string): void {
    this.attackers.update((list) => (list.length > 1 ? list.filter((a) => a.id !== attackerId) : list));
  }

  protected onAddAttack(attacker: Attacker): void {
    addAttackTo(attacker);
  }

  protected onRemoveAttack(attacker: Attacker, rowId: string): void {
    removeAttackFrom(attacker, rowId);
  }

  /** Hamburger menu's "Reset": wipes the target's profile AND its DEF/ARM/Boxes (unlike the
   *  Target profile pop-up's own Reset, which only touches the profile), and collapses the
   *  attack sequence back down to a single default attacker with a single default attack. */
  protected resetAll(): void {
    resetTargetFully(this.target);
    this.attackers.set([createAttacker()]);
  }
}
