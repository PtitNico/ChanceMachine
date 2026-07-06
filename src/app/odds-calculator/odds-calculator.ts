import { ChangeDetectionStrategy, Component, WritableSignal, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AttackType } from '../engine/attack-model';
import { OddsEngine } from '../engine/odds-engine';
import { SequencedAttack } from '../engine/sequence';

let nextRowId = 0;

/**
 * One editable row in the attack sequence builder. Each field is its own
 * signal (rather than one signal holding a plain object) so that editing a
 * single field doesn't require cloning the whole row - the sequence
 * `computed` below just reads whichever signals it needs.
 */
interface AttackRow {
  readonly id: string;
  readonly attackerName: WritableSignal<string>;
  readonly label: WritableSignal<string>;
  readonly type: WritableSignal<AttackType>;
  readonly stat: WritableSignal<number>;
  readonly boostDice: WritableSignal<number>;
  readonly forceAutoHit: WritableSignal<boolean>;
  readonly pow: WritableSignal<number>;
  readonly damageBoostDice: WritableSignal<number>;
  readonly knockdown: WritableSignal<boolean>;
  readonly brutalDamageDice: WritableSignal<number>;
}

function createAttackRow(attackerName: string): AttackRow {
  return {
    id: `attack-${nextRowId++}`,
    attackerName: signal(attackerName),
    label: signal('Melee attack'),
    type: signal<AttackType>('melee'),
    stat: signal(6),
    boostDice: signal(0),
    forceAutoHit: signal(false),
    pow: signal(12),
    damageBoostDice: signal(0),
    knockdown: signal(false),
    brutalDamageDice: signal(0),
  };
}

@Component({
  selector: 'app-odds-calculator',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './odds-calculator.html',
  styleUrl: './odds-calculator.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OddsCalculator {
  private readonly engine = inject(OddsEngine);

  protected readonly attackTypes: AttackType[] = ['melee', 'ranged', 'arcane'];

  // --- Target (shared across the whole sequence) ---
  protected readonly targetDef = signal(13);
  protected readonly targetArm = signal(15);
  protected readonly targetBoxes = signal(5);
  protected readonly tough = signal(false);
  protected readonly toughOn = signal(5);

  // --- Attack sequence ---
  protected readonly rows = signal<AttackRow[]>([createAttackRow('Attacker 1')]);

  private readonly sequencedAttacks = computed<SequencedAttack[]>(() =>
    this.rows().map((r) => ({
      id: r.id,
      attackerName: r.attackerName(),
      label: r.label(),
      type: r.type(),
      stat: r.stat(),
      modifiers: r.boostDice() > 0 ? { boostDice: r.boostDice() } : undefined,
      pow: r.pow(),
      damageModifiers: r.damageBoostDice() > 0 ? { boostDice: r.damageBoostDice() } : undefined,
      criticalEffects:
        r.knockdown() || r.brutalDamageDice() > 0
          ? { knockdown: r.knockdown() || undefined, brutalDamageDice: r.brutalDamageDice() || undefined }
          : undefined,
      forceAutoHit: r.forceAutoHit(),
    }))
  );

  /** Recomputed automatically whenever any row or target input changes. */
  protected readonly sequence = computed(() =>
    this.engine.computeSequence(this.sequencedAttacks(), {
      def: this.targetDef(),
      arm: this.targetArm(),
      boxes: this.targetBoxes(),
      tough: this.tough(),
      toughOn: this.toughOn(),
    })
  );

  protected readonly visibleSurvivalPoints = computed(() =>
    this.sequence()
      .survivalDistribution.filter((p) => p.probability >= 0.0005)
      .sort((a, b) => b.boxes - a.boxes)
  );

  protected readonly maxSurvivalProbability = computed(() =>
    Math.max(...this.visibleSurvivalPoints().map((p) => p.probability), 0.0001)
  );

  protected addAttack(): void {
    this.rows.update((rows) => {
      const lastAttacker = rows.at(-1)?.attackerName() ?? 'Attacker 1';
      return [...rows, createAttackRow(lastAttacker)];
    });
  }

  protected removeAttack(id: string): void {
    this.rows.update((rows) => (rows.length > 1 ? rows.filter((r) => r.id !== id) : rows));
  }

  protected moveAttack(id: string, direction: -1 | 1): void {
    this.rows.update((rows) => {
      const index = rows.findIndex((r) => r.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= rows.length) return rows;
      const next = [...rows];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  protected pct(value: number): string {
    return `${(value * 100).toFixed(1)}%`;
  }
}
