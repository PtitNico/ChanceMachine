import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Minimal shape either summary source needs: `EffectSummaryTag` (attack-row.model.ts) and
 *  `TargetSummaryTag` (target-panel.model.ts) both satisfy this structurally (their own `key`
 *  types are narrower string unions, which is fine here - this component never needs to know
 *  which one it's showing, just how to render and track each tag). */
export interface EffectTag {
  readonly key: string;
  readonly label: string;
}

/** The small pill-tag row summarizing active effects/capabilities, shown under an attack row
 *  (`effectsSummary`) or the Target row (`targetSummary`) - identical markup and styling in both
 *  places, so this is the one component both render it through. */
@Component({
  selector: 'app-effect-tags',
  standalone: true,
  templateUrl: './effect-tags.html',
  styleUrls: ['../shared/effect-tags.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EffectTags {
  readonly tags = input.required<readonly EffectTag[]>();
}
