import { ChangeDetectionStrategy, Component, ElementRef, ViewChild, WritableSignal, afterNextRender, input } from '@angular/core';

/**
 * A `contenteditable` span bound directly to a `WritableSignal<string>` (same "pass the signal
 * itself" convention `MiniFieldSelect` uses) - click/tap the text directly to rename, no separate
 * input/button pair. Originally `AttackerCard`'s own inline name span, extracted once
 * `TargetProfileDialog`'s repeatable "custom effect" rows needed the exact same behavior: each
 * `@for`-rendered row gets its OWN component instance, so its own constructor-level
 * `afterNextRender` fires exactly once at THAT row's creation - correctly handling rows added
 * later (not just whatever exists at first render), which a single shared `afterNextRender` in the
 * parent dialog's own constructor could never do for a dynamic list.
 */
@Component({
  selector: 'app-editable-name',
  standalone: true,
  templateUrl: './editable-name.html',
  styleUrls: ['./editable-name.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EditableName {
  readonly nameSignal = input.required<WritableSignal<string>>();
  readonly placeholder = input('');
  readonly ariaLabel = input('Name');

  @ViewChild('nameSpan') private nameSpanRef?: ElementRef<HTMLSpanElement>;

  constructor() {
    /* The span's content is set here, once, imperatively - NOT via a template interpolation bound
     * to the signal. Angular's own text-interpolation tracks a specific DOM text node it created;
     * contenteditable typing can make the browser create its own separate text node instead of
     * reusing that one, and if the signal is later updated (on blur) Angular then writes into ITS
     * now-stale node too, leaving both in the DOM at once (visibly duplicating the name). Setting
     * textContent exactly once up front, and only ever afterwards on blur - see onBlur - sidesteps
     * that entirely: nothing about typing ever touches a live binding. */
    afterNextRender(() => {
      if (this.nameSpanRef) {
        this.nameSpanRef.nativeElement.textContent = this.nameSignal()();
      }
    });
  }

  /** Commits the contenteditable span's final text back to the signal - only on blur, never on
   *  every keystroke, so nothing ever re-renders the span's content while the user is typing. */
  protected onBlur(span: HTMLElement): void {
    const text = span.textContent?.trim() ?? '';
    if (!text) {
      span.textContent = '';
    }
    this.nameSignal().set(text);
  }
}
