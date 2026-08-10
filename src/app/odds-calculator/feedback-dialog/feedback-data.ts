import { AttackRow, TriggerEffectKey } from '../attack-row.model';
import { Attacker } from '../attacker.model';
import { Target, TargetState } from '../target-panel/target-panel.model';

/** Reads through every signal on one attack row into a plain, JSON-friendly object - core weapon
 *  stats are always included, but every field that's "off"/at its default (rof, reload, the ARM
 *  penalty amounts, a scoped-down target list, and any untriggered effect) is left out entirely
 *  rather than sent as a 0/'-'/null/empty-object placeholder, so a report only carries what the
 *  reporter actually configured. */
function serializeAttackRow(row: AttackRow): Record<string, unknown> {
  const effects = row.triggerEffects
    .filter((e) => e.trigger() !== 'off')
    .reduce((acc, e) => ({ ...acc, [e.key]: e.trigger() }), {} as Record<TriggerEffectKey, string>);
  const eligibleTargetIds = row.eligibleTargetIds();
  return {
    type: row.type(),
    diceCount: row.diceCount(),
    pow: row.pow(),
    damageDiceCount: row.damageDiceCount(),
    attackCount: row.attackCount(),
    ...(row.rof() !== '-' && { rof: row.rof() }),
    ...(row.reload() > 0 && { reload: row.reload() }),
    ...(row.armPenaltyHitAmount() > 0 && { armPenaltyHitAmount: row.armPenaltyHitAmount() }),
    ...(row.armPenaltyCritAmount() > 0 && { armPenaltyCritAmount: row.armPenaltyCritAmount() }),
    ...(Object.keys(effects).length > 0 && { effects }),
    ...(eligibleTargetIds && { eligibleTargetIds }),
  };
}

/** Same "only what's actually set" pruning as `serializeAttackRow` - DEF/ARM/Boxes are always
 *  included (every target has them), every other capability is left out while at its off/0/false
 *  default. */
function serializeTargetState(state: TargetState): Record<string, unknown> {
  return {
    def: state.def(),
    arm: state.arm(),
    boxes: state.boxes(),
    ...(state.focusPoints() > 0 && { focusPoints: state.focusPoints() }),
    ...(state.furyPoints() > 0 && { furyPoints: state.furyPoints() }),
    ...(state.offensiveKnowledgeOfTheDamned() > 0 && {
      offensiveKnowledgeOfTheDamned: state.offensiveKnowledgeOfTheDamned(),
    }),
    ...(state.defensiveKnowledgeOfTheDamned() > 0 && {
      defensiveKnowledgeOfTheDamned: state.defensiveKnowledgeOfTheDamned(),
    }),
    ...(state.shieldGuards() > 0 && { shieldGuards: state.shieldGuards() }),
    ...(state.scapegoats() > 0 && { scapegoats: state.scapegoats() }),
    ...(state.toughKind() !== 'off' && { toughKind: state.toughKind() }),
    ...(state.shieldAmount() > 0 && { shieldAmount: state.shieldAmount() }),
    ...(state.unyielding() && { unyielding: true }),
    ...(state.carapace() && { carapace: true }),
    ...(state.dispellableTough() && { dispellableTough: true }),
    ...(state.dispellableUnyielding() && { dispellableUnyielding: true }),
    ...(state.rapidHealing() && { rapidHealing: true }),
    ...(state.spellDefAmount() > 0 && { spellDefAmount: state.spellDefAmount() }),
    ...(state.spellArmAmount() > 0 && { spellArmAmount: state.spellArmAmount() }),
    ...(state.upkeepSpellDefAmount() > 0 && { upkeepSpellDefAmount: state.upkeepSpellDefAmount() }),
    ...(state.upkeepSpellArmAmount() > 0 && { upkeepSpellArmAmount: state.upkeepSpellArmAmount() }),
  };
}

/** Turns the current sequence builder state into a plain JSON string - attached to a Feedback/bug
 *  report submission (see `feedback-dialog.ts`) so a report can be reproduced exactly instead of
 *  relying on the reporter to describe their setup in prose. Every field is read through its own
 *  signal here (not `JSON.stringify`'d directly - a `WritableSignal` isn't serializable on its
 *  own), mirroring the explicit per-field mapping `toSequencedAttack` already uses for the same
 *  UI-state-to-plain-object conversion. Fields left at their default (see `serializeAttackRow`/
 *  `serializeTargetState`, and `puppetMaster`/`focusPoints`/`charge` below) are omitted rather than
 *  sent as false/0/'off', keeping a report focused on what was actually configured. */
export function serializeFeedbackData(targets: Target[], attackers: Attacker[]): string {
  return JSON.stringify({
    targets: targets.map((target) => ({ name: target.name(), ...serializeTargetState(target.state) })),
    attackers: attackers.map((attacker) => ({
      name: attacker.name(),
      mat: attacker.mat(),
      rat: attacker.rat(),
      aat: attacker.aat(),
      ...(attacker.puppetMaster() && { puppetMaster: true }),
      ...(attacker.focusPoints() > 0 && { focusPoints: attacker.focusPoints() }),
      ...(attacker.charge() !== 'off' && { charge: attacker.charge() }),
      weapons: attacker.attacks().map(serializeAttackRow),
    })),
  });
}
