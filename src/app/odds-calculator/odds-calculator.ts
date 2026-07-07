import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  ViewChild,
  WritableSignal,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AttackType } from '../engine/attack-model';
import { OddsEngine } from '../engine/odds-engine';
import { SequencedAttack } from '../engine/sequence';

let nextRowId = 0;

/** Inclusive integer range, used to build <select> option lists. */
function range(start: number, end: number): number[] {
  const values: number[] = [];
  for (let i = start; i <= end; i++) values.push(i);
  return values;
}

/** A POW of '-' means the attack deals no damage at all (a utility attack whose only
 *  purpose is a critical effect, e.g. Knockdown) - still resolved as a normal to-hit
 *  roll (so it can still crit), just mapped to a POW low enough that damage always
 *  floors at 0 regardless of dice or ARM. */
const NO_DAMAGE_POW = -9999;
function resolvePow(pow: number | '-'): number {
  return pow === '-' ? NO_DAMAGE_POW : pow;
}

const DEF_OPTIONS: (number | 'KD')[] = ['KD', ...range(5, 25)];
const ARM_OPTIONS = range(1, 35);
const BOXES_OPTIONS = range(1, 99);
const RESOURCE_OPTIONS = range(0, 15); // Focus / Fury
const STAT_OPTIONS = range(0, 20); // MAT / RAT / AAT
const POW_OPTIONS: (number | '-')[] = ['-', ...range(0, 30)];
const DICE_OPTIONS = range(1, 6);

/**
 * One editable row in the attack sequence builder. Each field is its own
 * signal (rather than one signal holding a plain object) so that editing a
 * single field doesn't require cloning the whole row - the sequence
 * `computed` below just reads whichever signals it needs.
 *
 * `diceCount` / `damageDiceCount` are the TOTAL number of d6 rolled (2 by
 * default, matching the game's baseline) rather than a boost count on top of
 * a hidden base - the user just picks the number of dice they're rolling.
 */
interface AttackRow {
  readonly id: string;
  readonly type: WritableSignal<AttackType>;
  readonly stat: WritableSignal<number>;
  readonly diceCount: WritableSignal<number>;
  readonly forceAutoHit: WritableSignal<boolean>;
  readonly pow: WritableSignal<number | '-'>;
  readonly damageDiceCount: WritableSignal<number>;
  readonly knockdown: WritableSignal<boolean>;
  readonly brutalDamageDice: WritableSignal<number>;
}

function createAttackRow(): AttackRow {
  return {
    id: `attack-${nextRowId++}`,
    type: signal<AttackType>('melee'),
    stat: signal(6),
    diceCount: signal(2),
    forceAutoHit: signal(false),
    pow: signal<number | '-'>(12),
    damageDiceCount: signal(2),
    knockdown: signal(false),
    brutalDamageDice: signal(0),
  };
}

/** Copies another row's current values into a brand new row (fresh signals, not shared references). */
function cloneAttackRow(source: AttackRow): AttackRow {
  return {
    id: `attack-${nextRowId++}`,
    type: signal(source.type()),
    stat: signal(source.stat()),
    diceCount: signal(source.diceCount()),
    forceAutoHit: signal(source.forceAutoHit()),
    pow: signal(source.pow()),
    damageDiceCount: signal(source.damageDiceCount()),
    knockdown: signal(source.knockdown()),
    brutalDamageDice: signal(source.brutalDamageDice()),
  };
}

function hasEffects(row: AttackRow): boolean {
  return row.forceAutoHit() || row.knockdown() || row.brutalDamageDice() > 0;
}

const STAT_LABELS: Record<AttackType, string> = { melee: 'MAT', ranged: 'RAT', arcane: 'AAT' };

/** Total dice picked by the user -> extra dice on top of the game's 2d6 baseline (never negative). */
function toBoostDice(diceCount: number): number {
  return Math.max(0, Math.floor(diceCount) - 2);
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
  protected readonly hasEffects = hasEffects;
  protected readonly statLabel = (type: AttackType) => STAT_LABELS[type];

  protected readonly defOptions = DEF_OPTIONS;
  protected readonly armOptions = ARM_OPTIONS;
  protected readonly boxesOptions = BOXES_OPTIONS;
  protected readonly resourceOptions = RESOURCE_OPTIONS;
  protected readonly statOptions = STAT_OPTIONS;
  protected readonly powOptions = POW_OPTIONS;
  protected readonly diceOptions = DICE_OPTIONS;

  /** <select> change events always carry a string - these convert back to the field's real type. */
  protected readonly toNumber = (raw: string) => Number(raw);
  protected readonly parseDef = (raw: string): number | 'KD' => (raw === 'KD' ? 'KD' : Number(raw));
  protected readonly parsePow = (raw: string): number | '-' => (raw === '-' ? '-' : Number(raw));

  // --- Target (shared across the whole sequence) ---
  protected readonly targetDef = signal<number | 'KD'>(13);
  protected readonly targetArm = signal(15);
  protected readonly targetBoxes = signal(5);
  protected readonly tough = signal(false); // always succeeds on 5+ (no configurable threshold)
  protected readonly targetFocus = signal(0);
  protected readonly targetFury = signal(0);

  // --- Attack sequence ---
  protected readonly rows = signal<AttackRow[]>([createAttackRow()]);

  private readonly sequencedAttacks = computed<SequencedAttack[]>(() =>
    this.rows().map((r, i) => ({
      id: r.id,
      attackerName: '',
      label: `Attack ${i + 1}`,
      type: r.type(),
      stat: r.stat(),
      modifiers: { boostDice: toBoostDice(r.diceCount()) },
      pow: resolvePow(r.pow()),
      damageModifiers: { boostDice: toBoostDice(r.damageDiceCount()) },
      criticalEffects:
        r.knockdown() || r.brutalDamageDice() > 0
          ? { knockdown: r.knockdown() || undefined, brutalDamageDice: r.brutalDamageDice() || undefined }
          : undefined,
      forceAutoHit: r.forceAutoHit(),
    }))
  );

  private static readonly MAX_RESOURCE_POINTS = 10;

  private static clampResourcePoints(value: number): number {
    return Math.max(0, Math.min(OddsCalculator.MAX_RESOURCE_POINTS, Math.floor(value || 0)));
  }

  /** Recomputed automatically whenever any row or target input changes. */
  protected readonly sequence = computed(() =>
    this.engine.computeSequence(this.sequencedAttacks(), {
      def: this.targetDef(),
      arm: this.targetArm(),
      boxes: this.targetBoxes(),
      tough: this.tough(),
      focusPoints: OddsCalculator.clampResourcePoints(this.targetFocus()),
      furyPoints: OddsCalculator.clampResourcePoints(this.targetFury()),
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

  protected pct(value: number): string {
    return `${(value * 100).toFixed(1)}%`;
  }

  // --- Effects popup (per attack row) ---
  @ViewChild('effectsDialog') private effectsDialog?: ElementRef<HTMLDialogElement>;
  protected readonly editingRow = signal<AttackRow | null>(null);

  protected openEffects(row: AttackRow): void {
    this.editingRow.set(row);
    this.effectsDialog?.nativeElement.showModal();
  }

  protected closeEffects(): void {
    this.effectsDialog?.nativeElement.close();
  }

  // --- Results details popup ---
  @ViewChild('detailsDialog') private detailsDialog?: ElementRef<HTMLDialogElement>;

  protected openDetails(): void {
    this.detailsDialog?.nativeElement.showModal();
  }

  protected closeDetails(): void {
    this.detailsDialog?.nativeElement.close();
  }

  /** Native <dialog> reports a click anywhere in the viewport while open; only the ::backdrop click has the dialog itself as target. */
  protected closeOnBackdropClick(event: MouseEvent, dialog: HTMLDialogElement): void {
    if (event.target === dialog) {
      dialog.close();
    }
  }
}
