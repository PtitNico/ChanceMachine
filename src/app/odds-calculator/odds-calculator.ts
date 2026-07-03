import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { OddsEngine } from '../engine/odds-engine';

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

  // --- Attack roll ---
  protected readonly attackStat = signal(6); // MAT or RAT
  protected readonly autoHit = signal(false); // target Knocked Down / Stationary
  protected readonly attackBoost = signal(0); // extra d6 from spending focus/fury

  // --- Damage roll ---
  protected readonly pow = signal(12);
  protected readonly damageBoost = signal(0);

  // --- Target ---
  protected readonly targetDef = signal(13);
  protected readonly targetArm = signal(15);
  protected readonly targetBoxes = signal(1);
  protected readonly tough = signal(false);
  protected readonly toughOn = signal(5);

  /** Recomputed automatically whenever any input signal above changes. */
  protected readonly odds = computed(() =>
    this.engine.compute({
      attack: {
        stat: this.attackStat(),
        autoHit: this.autoHit(),
        modifiers: this.attackBoost() > 0 ? { boostDice: this.attackBoost() } : undefined,
      },
      damage: {
        pow: this.pow(),
        modifiers: this.damageBoost() > 0 ? { boostDice: this.damageBoost() } : undefined,
      },
      target: {
        def: this.targetDef(),
        arm: this.targetArm(),
        boxesRemaining: this.targetBoxes(),
        tough: this.tough(),
        toughOn: this.toughOn(),
      },
    })
  );

  /** Damage points worth showing in the readout (hide vanishingly rare tail values). */
  protected readonly visibleDamagePoints = computed(() =>
    this.odds()
      .damageDistribution.filter((p) => p.probability >= 0.0005)
      .sort((a, b) => b.damage - a.damage)
  );

  protected readonly maxBarProbability = computed(() =>
    Math.max(...this.visibleDamagePoints().map((p) => p.probability), 0.0001)
  );

  protected pct(value: number): string {
    return `${(value * 100).toFixed(1)}%`;
  }
}
