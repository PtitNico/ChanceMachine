import { AttackRow, TriggerEffectKey } from '../attack-row.model';
import { Attacker } from '../attacker.model';
import { Target, TargetState } from '../target-panel/target-panel.model';

/** Reads through every signal on one attack row into a plain, JSON-friendly object - only the
 *  triggered effects are included (an 'off' effect carries no information worth sending). */
function serializeAttackRow(row: AttackRow): Record<string, unknown> {
  return {
    type: row.type(),
    diceCount: row.diceCount(),
    pow: row.pow(),
    damageDiceCount: row.damageDiceCount(),
    attackCount: row.attackCount(),
    rof: row.rof(),
    reload: row.reload(),
    armPenaltyHitAmount: row.armPenaltyHitAmount(),
    armPenaltyCritAmount: row.armPenaltyCritAmount(),
    effects: row.triggerEffects
      .filter((e) => e.trigger() !== 'off')
      .reduce((acc, e) => ({ ...acc, [e.key]: e.trigger() }), {} as Record<TriggerEffectKey, string>),
    eligibleTargetIds: row.eligibleTargetIds(),
  };
}

function serializeTargetState(state: TargetState): Record<string, unknown> {
  return {
    def: state.def(),
    arm: state.arm(),
    boxes: state.boxes(),
    focusPoints: state.focusPoints(),
    furyPoints: state.furyPoints(),
    offensiveKnowledgeOfTheDamned: state.offensiveKnowledgeOfTheDamned(),
    defensiveKnowledgeOfTheDamned: state.defensiveKnowledgeOfTheDamned(),
    shieldGuards: state.shieldGuards(),
    scapegoats: state.scapegoats(),
    toughKind: state.toughKind(),
    shieldAmount: state.shieldAmount(),
    unyielding: state.unyielding(),
    carapace: state.carapace(),
    dispellableTough: state.dispellableTough(),
    dispellableUnyielding: state.dispellableUnyielding(),
    rapidHealing: state.rapidHealing(),
    spellDefAmount: state.spellDefAmount(),
    spellArmAmount: state.spellArmAmount(),
    upkeepSpellDefAmount: state.upkeepSpellDefAmount(),
    upkeepSpellArmAmount: state.upkeepSpellArmAmount(),
  };
}

/** Turns the current sequence builder state into a plain JSON string - attached to a Feedback/bug
 *  report submission (see `feedback-dialog.ts`) so a report can be reproduced exactly instead of
 *  relying on the reporter to describe their setup in prose. Every field is read through its own
 *  signal here (not `JSON.stringify`'d directly - a `WritableSignal` isn't serializable on its
 *  own), mirroring the explicit per-field mapping `toSequencedAttack` already uses for the same
 *  UI-state-to-plain-object conversion. */
export function serializeFeedbackData(targets: Target[], attackers: Attacker[]): string {
  return JSON.stringify({
    targets: targets.map((target) => ({ name: target.name(), ...serializeTargetState(target.state) })),
    attackers: attackers.map((attacker) => ({
      name: attacker.name(),
      mat: attacker.mat(),
      rat: attacker.rat(),
      aat: attacker.aat(),
      puppetMaster: attacker.puppetMaster(),
      focusPoints: attacker.focusPoints(),
      charge: attacker.charge(),
      weapons: attacker.attacks().map(serializeAttackRow),
    })),
  });
}
