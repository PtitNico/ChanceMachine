import { ChangeDetectionStrategy, Component, ViewChild, computed, signal } from '@angular/core';
import { Attacker, attackerDisplayName } from '../attacker.model';
import { DialogShell } from '../dialog-shell/dialog-shell';

/** Attacker-level capabilities pop-up (currently just Puppet Master - Focus lives inline on the
 *  card now, see `AttackerCard`) - one shared instance reused for every attacker, same shape as
 *  `AttackEditDialog`'s single reused instance per attack. */
@Component({
  selector: 'app-attacker-rules-dialog',
  standalone: true,
  imports: [DialogShell],
  templateUrl: './attacker-rules-dialog.html',
  styleUrls: ['../shared/dialog-sections.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AttackerRulesDialog {
  @ViewChild('shell') private shell?: DialogShell;

  protected readonly attacker = signal<Attacker | null>(null);
  private readonly index = signal(0);

  /** Falls back to a generic title only for the brief instant before `open()` first sets an
   *  attacker - `title` is `input.required`, so `DialogShell` needs a value even then. */
  protected readonly title = computed(() => {
    const a = this.attacker();
    return a ? attackerDisplayName(a, this.index()) : "Attacker's special rules";
  });

  open(attacker: Attacker, index: number): void {
    this.attacker.set(attacker);
    this.index.set(index);
    this.shell?.open();
  }
}
