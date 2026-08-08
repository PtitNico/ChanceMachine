import { CdkDrag, CdkDragDrop, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  ViewChild,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { OddsEngine } from '../engine/odds-engine';
import { chanceToDestroyAllTargets, SequencedAttack, SequenceTarget, summarizeFocusStrategy } from '../engine/sequence';
import { AboutDialog } from './about-dialog/about-dialog';
import { AppMenu } from './app-menu/app-menu';
import { AttackEditDialog } from './attack-edit-dialog/attack-edit-dialog';
import { TYPE_EMOJI, toSequencedAttack } from './attack-row.model';
import { AttackerCard } from './attacker-card/attacker-card';
import { AttackerRulesDialog } from './attacker-rules-dialog/attacker-rules-dialog';
import { Attacker, addAttackTo, attackerDisplayName, createAttacker, removeAttackFrom, statFor } from './attacker.model';
import { ChangelogDialog } from './changelog-dialog/changelog-dialog';
import { DamagePoint, FocusStrategyBlock, ShotRow } from './details-dialog/details-dialog.model';
import { DetailsDialog } from './details-dialog/details-dialog';
import { FeedbackDialog } from './feedback-dialog/feedback-dialog';
import { PwaInstallBanner } from './pwa-install-banner/pwa-install-banner';
import { ResultsPanel } from './results-panel/results-panel';
import { TargetPanel } from './target-panel/target-panel';
import {
  Target,
  createTarget,
  effectiveCarapace,
  effectiveToughKind,
  effectiveUnyielding,
  shieldArmBonus,
  spellArmBonus,
  spellArmBonusPostDispel,
  spellDefBonus,
  spellDefBonusPostDispel,
  targetDisplayName,
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
  private readonly injector = inject(Injector);

  /** The scrollable list of attacker cards (see `.attacker-list` in odds-calculator.css) - used
   *  by `onAddAttacker` to scroll a freshly-added card into view. */
  @ViewChild('attackerList') private attackerListRef?: ElementRef<HTMLDivElement>;
  /** Same idea as `attackerListRef`, for the target list - see `onAddTarget`. */
  @ViewChild('targetList') private targetListRef?: ElementRef<HTMLDivElement>;

  // --- Targets: attacks resolve against the first (still-alive) target until it's destroyed,
  // then spill onto the next - see sequence.ts's "Multiple targets" module doc comment section. ---
  protected readonly targets = signal<Target[]>([createTarget()]);

  // --- Attack sequence, grouped by attacker ---
  protected readonly attackers = signal<Attacker[]>([createAttacker()]);

  /** Attacks still resolve as ONE flat ordered sequence for the engine, regardless of which
   *  attacker owns them - `stat`/`attackerName` are no longer the row's own values (see
   *  attacker.model.ts), so they're resolved here from the row's parent attacker. `attackerIndex`
   *  (this loop's own index, not the display name) is Puppet Master's stable grouping key - see
   *  `sequence.ts`'s `SequencedAttack` doc comment for why `attackerName` can't be used for that.
   *  `targets()` is passed through so each row's own `eligibleTargetIds` (stable ids) can be
   *  resolved into the engine's index-based `eligibleTargetIndices`. */
  private readonly sequencedAttacks = computed<SequencedAttack[]>(() => {
    const result: SequencedAttack[] = [];
    const targets = this.targets();
    this.attackers().forEach((attacker, attackerIndex) => {
      const name = attackerDisplayName(attacker, attackerIndex);
      const rows = attacker.attacks();
      const firstMeleeId = rows.find((r) => r.type() === 'melee')?.id;
      for (const row of rows) {
        result.push(toSequencedAttack(
          row, result.length, statFor(attacker, row.type()), name, attackerIndex,
          attacker.puppetMaster(), attacker.focusPoints(), targets,
          attacker.charge(), row.id === firstMeleeId
        ));
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

  private static toSequenceTarget(target: Target): SequenceTarget {
    const state = target.state;
    return {
      def: state.def(),
      arm: state.arm(),
      boxes: state.boxes(),
      tough: effectiveToughKind(state) === 'tough',
      toughSteady: effectiveToughKind(state) === 'toughSteady',
      toughPostDispel: state.toughKind() === 'tough',
      toughSteadyPostDispel: state.toughKind() === 'toughSteady',
      focusPoints: OddsCalculator.clampResourcePoints(state.focusPoints()),
      furyPoints: OddsCalculator.clampResourcePoints(state.furyPoints()),
      offensiveKnowledgeOfTheDamned: OddsCalculator.clampResourcePoints(state.offensiveKnowledgeOfTheDamned()),
      defensiveKnowledgeOfTheDamned: OddsCalculator.clampResourcePoints(state.defensiveKnowledgeOfTheDamned()),
      shieldGuards: OddsCalculator.clampResourcePoints(state.shieldGuards()),
      scapegoats: OddsCalculator.clampToCap(state.scapegoats(), OddsCalculator.MAX_SCAPEGOATS),
      shieldArmBonus: shieldArmBonus(state),
      spellArmBonus: spellArmBonus(state),
      spellArmBonusPostDispel: spellArmBonusPostDispel(state),
      defBonus: spellDefBonus(state),
      defBonusPostDispel: spellDefBonusPostDispel(state),
      unyielding: effectiveUnyielding(state),
      unyieldingPostDispel: state.unyielding(),
      carapace: effectiveCarapace(state),
      carapacePostDispel: state.carapace(),
      rapidHealing: state.rapidHealing(),
    };
  }

  /** Recomputed automatically whenever any target's own profile changes. */
  private readonly sequenceTargets = computed<SequenceTarget[]>(() => this.targets().map(OddsCalculator.toSequenceTarget));

  /** `OddsEngine` runs the actual computation in a Web Worker (see its own doc comment) - this
   *  effect just kicks off a new run whenever the inputs change; the result/progress/calculating
   *  signals below are read straight from the engine, not held here. */
  constructor() {
    effect(() => {
      this.engine.computeSequence(this.sequencedAttacks(), this.sequenceTargets());
    });
  }

  /** One entry per target, in order - see `computeMultiTargetSequenceOdds`. */
  protected readonly sequence = this.engine.result;
  protected readonly calculating = this.engine.calculating;
  protected readonly progress = this.engine.progress;

  protected readonly targetNames = computed<string[]>(() => {
    const targets = this.targets();
    return targets.map((t, i) => targetDisplayName(t, i, targets.length));
  });

  protected readonly destroyChanceByTarget = computed<number[]>(() => this.sequence().map((t) => t.result.finalDestroyChance));

  /** Only meaningful once there's more than one target - see `chanceToDestroyAllTargets`'s own
   *  doc comment for why this is a genuine joint computation, not just `destroyChanceByTarget`
   *  multiplied together. */
  protected readonly chanceToDestroyAll = computed<number | null>(() => {
    const results = this.sequence();
    return results.length > 1 ? chanceToDestroyAllTargets(this.sequencedAttacks(), results) : null;
  });

  /** Damage -> probability, per target, UNFILTERED and un-labelled - see
   *  `damageDistributionPointsByTarget` (the filtered/labelled display version) and
   *  `averageDamageByTarget` (its expected value), both derived from this so they stay consistent
   *  with each other. A target's own `result` only accounts for mass the engine actually resolved
   *  against it - mass that never reached it at all (an earlier target survived, or a mid-volley
   *  redirect landed on a weapon out of THIS target's own range - see `sequence.ts`'s "Multiple
   *  targets" module doc comment section) is folded in here as "0 damage, full boxes" (the same
   *  bucket a genuine miss would land in) rather than silently vanishing from the total, which
   *  would otherwise make a barely-engaged target's own average damage read as unrealistically high. */
  private readonly rawDamageDistributionByTarget = computed<Map<number, number>[]>(() =>
    this.sequence().map((t, targetIndex) => {
      const { survivalDistribution, finalDestroyChance } = t.result;
      const boxesInitial = this.targets()[targetIndex]?.state.boxes() ?? 0;

      const points = new Map<number, number>();
      for (const p of survivalDistribution) {
        const damage = boxesInitial - p.boxes;
        points.set(damage, (points.get(damage) ?? 0) + p.probability);
      }
      const accountedFor = finalDestroyChance + survivalDistribution.reduce((sum, p) => sum + p.probability, 0);
      const neverTouchedMass = Math.max(0, 1 - accountedFor);
      if (neverTouchedMass > 0) {
        points.set(0, (points.get(0) ?? 0) + neverTouchedMass);
      }
      if (finalDestroyChance > 0) {
        points.set(boxesInitial, (points.get(boxesInitial) ?? 0) + finalDestroyChance);
      }
      return points;
    })
  );

  /** Total damage dealt over the whole sequence against target `targetIndex`, one aggregated
   *  bucket for every outcome that destroys it (>= boxesInitial damage, labelled "N+") - since a
   *  destroyed target's exact overkill isn't tracked, only that it reached or exceeded its box count. */
  protected readonly damageDistributionPointsByTarget = computed<DamagePoint[][]>(() =>
    this.rawDamageDistributionByTarget().map((points, targetIndex) => {
      const boxesInitial = this.targets()[targetIndex]?.state.boxes() ?? 0;
      return [...points.entries()]
        .map(([damage, probability]) => ({ damage, label: damage >= boxesInitial ? `${boxesInitial}+` : `${damage}`, probability }))
        .filter((p) => p.probability >= 0.0005)
        .sort((a, b) => a.damage - b.damage);
    })
  );

  protected readonly maxDamageProbabilityByTarget = computed<number[]>(() =>
    this.damageDistributionPointsByTarget().map((points) => Math.max(...points.map((p) => p.probability), 0.0001))
  );

  /** Expected value of `rawDamageDistributionByTarget` - see its own doc comment for why this
   *  isn't simply `boxesInitial - steps.at(-1).expectedBoxesRemaining` anymore. */
  protected readonly averageDamageByTarget = computed<number[]>(() =>
    this.rawDamageDistributionByTarget().map((points) => [...points.entries()].reduce((sum, [damage, p]) => sum + damage * p, 0))
  );

  /** Flattens each target's own `result.steps[].shots[]` (one array per weapon, one entry per shot
   *  in that weapon's own volley) into a single continuously-numbered list for the Details pop-up -
   *  see `docs`/`sequence.ts`'s own doc comments. A step with no shots at all is a no-op row for
   *  THIS target (the weapon isn't in its range, or - for a later target - hasn't come under fire
   *  yet on this row) and is skipped entirely, so each target's own list only ever shows the
   *  weapons that could actually hit it. `isNewWeapon` marks every weapon's own first shot so the
   *  template can render a group header (attacker name + weapon type icon); `isNewAttacker` (a
   *  strict subset) additionally compares `attackerIndex` (not the display name - see
   *  `SequencedAttack`'s own doc comment) against the last RENDERED weapon's, so consecutive
   *  weapons owned by the same attacker share one header line. */
  protected readonly shotRowsByTarget = computed<ShotRow[][]>(() =>
    this.sequence().map((t) => {
      const rows: ShotRow[] = [];
      let previousAttackerIndex: number | undefined;
      t.result.steps.forEach((step) => {
        if (step.shots.length === 0) return;
        const isNewAttacker = rows.length === 0 || step.attack.attackerIndex !== previousAttackerIndex;
        step.shots.forEach((shot, shotIndex) => {
          rows.push({
            key: `${step.attack.id}-${shotIndex}`,
            label: `${rows.length + 1}`,
            isNewWeapon: shotIndex === 0,
            isNewAttacker: shotIndex === 0 && isNewAttacker,
            attackerName: step.attack.attackerName,
            typeEmoji: TYPE_EMOJI[step.attack.type],
            occursChance: shot.occursChance,
            hitChance: shot.hitChance,
            critChance: shot.critChance,
            averageDamage: shot.averageDamage,
          });
        });
        previousAttackerIndex = step.attack.attackerIndex;
      });
      return rows;
    })
  );

  /** One block per Focus-enabled attacker, its own name as a heading, holding one bullet per
   *  target that attacker's Focus actually reaches - see `summarizeFocusStrategy`'s own doc
   *  comment. Bullets stay separate per target (with a "vs TargetName:" prefix once there's more
   *  than one) rather than merged into one sentence: Focus IS one shared pool across targets (see
   *  sequence.ts's Attacker Focus section), but a merged sentence would blur together decisions the
   *  policy made under very different circumstances (e.g. "always boost the ranged attack against a
   *  1-box solo" and "mix boosting/buying against an 18-box heavy") into one misleadingly generic
   *  line - each target's own `result.focusStrategy` entry already carries exactly the slice of the
   *  story that happened while fighting IT, so there's nothing to merge, just group under one
   *  heading. Skips a (attacker, target) pair entirely when none of that attacker's own rows are
   *  even eligible for that target (see `reachesTarget`) - `focusStrategy` is seeded from EVERY
   *  Focus-enabled attacker regardless of eligibility (see single-target.ts), so without this check
   *  an attacker with no weapon in range of some target would still print a misleading "rarely
   *  worth spending Focus here" bullet for a target it could never even reach. Empty whenever no
   *  attacker has Focus active. */
  protected readonly focusStrategyBlocks = computed<FocusStrategyBlock[]>(() => {
    const results = this.sequence();
    const attackers = this.attackers();
    const targetNames = this.targetNames();
    const attacks = this.sequencedAttacks();
    const multipleTargets = results.length > 1;

    const reachesTarget = (attackerIndex: number, targetIndex: number): boolean =>
      attacks.some((a) => a.attackerIndex === attackerIndex && (!a.eligibleTargetIndices || a.eligibleTargetIndices.includes(targetIndex)));

    const bulletsByAttacker = new Map<number, string[]>();
    results.forEach((t, targetIndex) => {
      for (const entry of t.result.focusStrategy) {
        if (!reachesTarget(entry.attackerIndex, targetIndex)) continue;
        const bullets = bulletsByAttacker.get(entry.attackerIndex) ?? [];
        bulletsByAttacker.set(entry.attackerIndex, bullets);
        bullets.push(...summarizeFocusStrategy(entry, multipleTargets ? targetNames[targetIndex] : undefined));
      }
    });

    return [...bulletsByAttacker.entries()].map(([attackerIndex, bullets]) => ({
      attackerName: attackerIndex < attackers.length ? attackerDisplayName(attackers[attackerIndex], attackerIndex) : `Attacker ${attackerIndex + 1}`,
      bullets,
    }));
  });

  /** Appends a new attacker card, then scrolls it into view - `.attacker-list` is the one part
   *  of the screen that scrolls (see odds-calculator.css), so a sequence with several attackers
   *  already on screen would otherwise leave the new card (and the "+ Add attacker" button,
   *  pinned right below the list) off-screen with no visible feedback that the click did anything. */
  protected onAddAttacker(): void {
    this.attackers.update((list) => [...list, createAttacker()]);
    afterNextRender(() => this.attackerListRef?.nativeElement.lastElementChild?.scrollIntoView({ block: 'nearest' }), {
      injector: this.injector,
    });
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

  /** Appends a new target card, cloning the LAST target's current profile ("default copies the
   *  last one" - see `createTarget`), then scrolls it into view - same UX as `onAddAttacker`. */
  protected onAddTarget(): void {
    this.targets.update((list) => [...list, createTarget(list.at(-1))]);
    afterNextRender(() => this.targetListRef?.nativeElement.lastElementChild?.scrollIntoView({ block: 'nearest' }), {
      injector: this.injector,
    });
  }

  /** A target can't be removed while it's the only one - same "always >=1" rule as attackers. */
  protected onRemoveTarget(targetId: string): void {
    this.targets.update((list) => (list.length > 1 ? list.filter((t) => t.id !== targetId) : list));
  }

  /** Hamburger menu's "Reset": wipes every target's profile AND DEF/ARM/Boxes, collapsing back
   *  down to a single default target (unlike the Target profile pop-up's own Reset, which only
   *  touches one target's profile), and collapses the attack sequence back down to a single
   *  default attacker with a single default attack. */
  protected resetAll(): void {
    this.targets.set([createTarget()]);
    this.attackers.set([createAttacker()]);
  }
}
