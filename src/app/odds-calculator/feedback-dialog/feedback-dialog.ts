import { ChangeDetectionStrategy, Component, ViewChild, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DialogShell } from '../dialog-shell/dialog-shell';

/**
 * Paste the Web App URL you get after deploying `google-apps-script/feedback.gs` (see that file's
 * header comment for the exact steps) - it looks like
 * `https://script.google.com/macros/s/AKfycb.../exec`. Left empty, the form disables itself with
 * an explanatory notice instead of silently failing.
 */
const FEEDBACK_ENDPOINT_URL =
  'https://script.google.com/macros/s/AKfycbzRsSJRZ5Xa-D3o7mOep10eVOtJEs6Jj4fbqpm4SVKK3OBoLmEoZzSbAq92iTebvz1E/exec';

export type FeedbackKind = 'feedback' | 'bug';
type SubmitState = 'idle' | 'sending' | 'sent' | 'error';

@Component({
  selector: 'app-feedback-dialog',
  standalone: true,
  imports: [FormsModule, DialogShell],
  templateUrl: './feedback-dialog.html',
  // Shared partials first, this component's own file last - see target-panel.ts for why.
  styleUrls: ['../shared/dialog-sections.css', './feedback-dialog.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FeedbackDialog {
  protected readonly kind = signal<FeedbackKind>('feedback');
  protected readonly message = signal('');
  protected readonly email = signal('');
  protected readonly state = signal<SubmitState>('idle');
  /** The current sequence builder state (targets/attackers/weapons), already serialized to JSON by
   *  the caller (see `serializeFeedbackData`) - captured once when the dialog opens rather than
   *  read live, so a report reflects whatever the reporter was actually looking at, not whatever
   *  they've since changed it to while typing their message. */
  private data = '';

  @ViewChild('shell') private shell?: DialogShell;

  open(data: string): void {
    this.data = data;
    this.state.set('idle');
    this.shell?.open();
  }

  protected setKind(kind: FeedbackKind): void {
    this.kind.set(kind);
  }

  protected async submit(): Promise<void> {
    if (!this.message().trim() || this.state() === 'sending') {
      return;
    }
    this.state.set('sending');
    const body = new FormData();
    body.set('type', this.kind());
    body.set('message', this.message().trim());
    body.set('email', this.email().trim());
    body.set('data', this.data);
    body.set('userAgent', navigator.userAgent);
    try {
      // Apps Script Web Apps don't send back CORS headers a browser fetch can read from a
      // different origin, so `mode: 'no-cors'` is the only way this request succeeds at all -
      // the tradeoff is an opaque response: this resolving only means the request was sent, not
      // that the script actually processed it (a genuinely broken/undeployed URL, or a script
      // error inside doPost, won't surface here). See feedback.gs's header comment for the setup.
      await fetch(FEEDBACK_ENDPOINT_URL, { method: 'POST', mode: 'no-cors', body });
      this.state.set('sent');
      this.message.set('');
      this.email.set('');
    } catch {
      this.state.set('error');
    }
  }
}
