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
import { AttackType, EffectTrigger } from '../engine/attack-model';
import { OddsEngine } from '../engine/odds-engine';
import { SequencedAttack, StatEffect, StatEffectType } from '../engine/sequence';

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
const ARM_PENALTY_OPTIONS = range(1, 10);

const STAT_LABELS: Record<AttackType, string> = { melee: 'MAT', ranged: 'RAT', arcane: 'AAT' };

/**
 * Every effect that can fire on a hit or specifically on a crit, rendered as a pair of
 * toggle buttons (one in the "On hit" group, one in "On crit") - clicking one sets this
 * effect's trigger, clicking the already-active one turns the effect off. Armor Piercing
 * and Decapitation are one-off (this attack only); the rest are persistent `StatEffect`s.
 */
type TriggerEffectKey = 'armorPiercing' | 'decapitation' | StatEffectType;

const STAT_EFFECT_TYPES: StatEffectType[] = [
  'knockdown',
  'stationary',
  'iceCage',
  'shadowbind',
  'blind',
  'paralysis',
  'flare',
  'weaken',
  'armPenalty',
];

const TRIGGER_EFFECT_KEYS: TriggerEffectKey[] = ['armorPiercing', 'decapitation', ...STAT_EFFECT_TYPES];

const TRIGGER_EFFECT_LABELS: Record<TriggerEffectKey, string> = {
  armorPiercing: 'Armor Piercing',
  decapitation: 'Decapitation',
  knockdown: 'Knockdown',
  stationary: 'Stationary',
  iceCage: 'Ice Cage (-2 DEF)',
  shadowbind: 'Shadowbind (-3 DEF)',
  blind: 'Blind (-4 DEF)',
  paralysis: 'Paralysis (DEF 5)',
  flare: 'Flare (-2 DEF)',
  weaken: 'Weaken (-2 DEF)',
  armPenalty: '-X ARM',
};

function isStatEffectKey(key: TriggerEffectKey): key is StatEffectType {
  return key !== 'armorPiercing' && key !== 'decapitation';
}

/** 'off' means this effect isn't active on this attack. */
interface TriggerEffectRow {
  readonly key: TriggerEffectKey;
  readonly trigger: WritableSignal<EffectTrigger | 'off'>;
  /** Only meaningful for 'armPenalty'. */
  readonly amount: WritableSignal<number>;
}

function createTriggerEffects(): TriggerEffectRow[] {
  return TRIGGER_EFFECT_KEYS.map((key) => ({ key, trigger: signal<EffectTrigger | 'off'>('off'), amount: signal(2) }));
}

function cloneTriggerEffects(source: TriggerEffectRow[]): TriggerEffectRow[] {
  return source.map((e) => ({ key: e.key, trigger: signal(e.trigger()), amount: signal(e.amount()) }));
}

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

  // General.
  readonly jumpTheShark: WritableSignal<boolean>;

  // Attack roll.
  readonly discardAttackLowest: WritableSignal<boolean>;
  readonly discardAttackHighest: WritableSignal<boolean>;
  readonly rerollAttack: WritableSignal<boolean>;
  readonly sanguineFate: WritableSignal<boolean>;

  // Damage roll.
  readonly discardDamageLowest: WritableSignal<boolean>;
  readonly discardDamageHighest: WritableSignal<boolean>;
  readonly rerollDamage: WritableSignal<boolean>;
  readonly trash: WritableSignal<boolean>;
  readonly shatter: WritableSignal<boolean>;

  // Crit only.
  readonly brutalDamage: WritableSignal<boolean>;

  // Everything triggerable on a hit and/or a crit (fixed set, always present - see TriggerEffectRow).
  readonly triggerEffects: TriggerEffectRow[];
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
    jumpTheShark: signal(false),
    discardAttackLowest: signal(false),
    discardAttackHighest: signal(false),
    rerollAttack: signal(false),
    sanguineFate: signal(false),
    discardDamageLowest: signal(false),
    discardDamageHighest: signal(false),
    rerollDamage: signal(false),
    trash: signal(false),
    shatter: signal(false),
    brutalDamage: signal(false),
    triggerEffects: createTriggerEffects(),
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
    jumpTheShark: signal(source.jumpTheShark()),
    discardAttackLowest: signal(source.discardAttackLowest()),
    discardAttackHighest: signal(source.discardAttackHighest()),
    rerollAttack: signal(source.rerollAttack()),
    sanguineFate: signal(source.sanguineFate()),
    discardDamageLowest: signal(source.discardDamageLowest()),
    discardDamageHighest: signal(source.discardDamageHighest()),
    rerollDamage: signal(source.rerollDamage()),
    trash: signal(source.trash()),
    shatter: signal(source.shatter()),
    brutalDamage: signal(source.brutalDamage()),
    triggerEffects: cloneTriggerEffects(source.triggerEffects),
  };
}

function resetEffects(row: AttackRow): void {
  row.forceAutoHit.set(false);
  row.jumpTheShark.set(false);
  row.discardAttackLowest.set(false);
  row.discardAttackHighest.set(false);
  row.rerollAttack.set(false);
  row.sanguineFate.set(false);
  row.discardDamageLowest.set(false);
  row.discardDamageHighest.set(false);
  row.rerollDamage.set(false);
  row.trash.set(false);
  row.shatter.set(false);
  row.brutalDamage.set(false);
  for (const effect of row.triggerEffects) {
    effect.trigger.set('off');
    effect.amount.set(2);
  }
}

/** Short "label (trigger)" summary strings for every active effect on a row, shown under the attack row. */
function effectsSummary(row: AttackRow): string[] {
  const parts: string[] = [];
  if (row.forceAutoHit()) parts.push('Auto-hit');
  if (row.jumpTheShark()) parts.push('Jump the Shark');
  if (row.discardAttackLowest()) parts.push('Discard lowest (atk)');
  if (row.discardAttackHighest()) parts.push('Discard highest (atk)');
  if (row.rerollAttack()) parts.push('Reroll (atk)');
  if (row.sanguineFate()) parts.push('Sanguine Fate');
  if (row.discardDamageLowest()) parts.push('Discard lowest (dmg)');
  if (row.discardDamageHighest()) parts.push('Discard highest (dmg)');
  if (row.rerollDamage()) parts.push('Reroll (dmg)');
  if (row.trash()) parts.push('Trash');
  if (row.shatter()) parts.push('Shatter');
  if (row.brutalDamage()) parts.push('Crit Brutal Damage');
  for (const effect of row.triggerEffects) {
    const trigger = effect.trigger();
    if (trigger === 'off') continue;
    let label =
      effect.key === 'armPenalty' ? `-${effect.amount()} ARM` : TRIGGER_EFFECT_LABELS[effect.key];
    if (trigger === 'crit') {
      label = `Crit ${label}`;
    }
    parts.push(label);
  }
  return parts;
}

/** Total dice picked by the user -> extra dice on top of the game's 2d6 baseline (never negative). */
function toBoostDice(diceCount: number): number {
  return Math.max(0, Math.floor(diceCount) - 2);
}

function discardModifier(lowest: boolean, highest: boolean): { highest?: number; lowest?: number } | undefined {
  if (!lowest && !highest) return undefined;
  return { highest: highest ? 1 : undefined, lowest: lowest ? 1 : undefined };
}

function triggerOf(row: AttackRow, key: TriggerEffectKey): EffectTrigger | undefined {
  const trigger = row.triggerEffects.find((e) => e.key === key)?.trigger();
  return trigger && trigger !== 'off' ? trigger : undefined;
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
  protected readonly effectsSummary = effectsSummary;
  protected readonly statLabel = (type: AttackType) => STAT_LABELS[type];
  protected readonly triggerEffectLabel = (key: TriggerEffectKey) => TRIGGER_EFFECT_LABELS[key];
  protected readonly isArmPenalty = (key: TriggerEffectKey) => key === 'armPenalty';

  protected readonly defOptions = DEF_OPTIONS;
  protected readonly armOptions = ARM_OPTIONS;
  protected readonly boxesOptions = BOXES_OPTIONS;
  protected readonly resourceOptions = RESOURCE_OPTIONS;
  protected readonly statOptions = STAT_OPTIONS;
  protected readonly powOptions = POW_OPTIONS;
  protected readonly diceOptions = DICE_OPTIONS;
  protected readonly armPenaltyOptions = ARM_PENALTY_OPTIONS;

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
    this.rows().map((r, i): SequencedAttack => {
      const statEffects: StatEffect[] = r.triggerEffects
        .filter((e) => isStatEffectKey(e.key) && e.trigger() !== 'off')
        .map(
          (e): StatEffect => ({
            type: e.key as StatEffectType,
            trigger: e.trigger() as EffectTrigger,
            amount: e.key === 'armPenalty' ? e.amount() : undefined,
          })
        );

      return {
        id: r.id,
        attackerName: '',
        label: `Attack ${i + 1}`,
        type: r.type(),
        stat: r.stat(),
        modifiers: {
          boostDice: toBoostDice(r.diceCount()),
          discard: discardModifier(r.discardAttackLowest(), r.discardAttackHighest()),
          reroll: r.rerollAttack() || undefined,
          treatOnesAsSixes: r.jumpTheShark() || undefined,
          extraCritDice: r.sanguineFate() ? 1 : undefined,
        },
        pow: resolvePow(r.pow()),
        damageModifiers: {
          boostDice: toBoostDice(r.damageDiceCount()),
          discard: discardModifier(r.discardDamageLowest(), r.discardDamageHighest()),
          reroll: r.rerollDamage() || undefined,
          treatOnesAsSixes: r.jumpTheShark() || undefined,
        },
        effects: {
          brutalDamageDice: r.brutalDamage() ? 1 : undefined,
          armorPiercing: triggerOf(r, 'armorPiercing'),
          decapitation: triggerOf(r, 'decapitation'),
          trash: r.trash() || undefined,
          shatter: r.shatter() || undefined,
        },
        statEffects: statEffects.length > 0 ? statEffects : undefined,
        forceAutoHit: r.forceAutoHit(),
      };
    })
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

  /** Total damage dealt over the whole sequence: `survivalDistribution` (boxes remaining if
   *  the target survives) converted to `boxesInitial - boxes`, plus one aggregated bucket for
   *  every outcome that destroys the target (>= boxesInitial damage, labelled "N+") - since a
   *  destroyed target's exact overkill isn't tracked, only that it reached or exceeded its box count. */
  protected readonly damageDistributionPoints = computed(() => {
    const { survivalDistribution, finalDestroyChance } = this.sequence();
    const boxesInitial = this.targetBoxes();

    const points = survivalDistribution.map((p) => ({
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

  protected resetEffects(row: AttackRow): void {
    resetEffects(row);
  }

  /** Toggling the already-active trigger for this effect turns it off; toggling the other one switches to it. */
  protected toggleTriggerEffect(effect: TriggerEffectRow, trigger: EffectTrigger): void {
    effect.trigger.set(effect.trigger() === trigger ? 'off' : trigger);
  }

  /** 'armPenalty' is always present in `triggerEffects` (fixed key set), so this is never undefined. */
  protected armPenaltyEffect(row: AttackRow): TriggerEffectRow {
    return row.triggerEffects.find((e) => e.key === 'armPenalty')!;
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
