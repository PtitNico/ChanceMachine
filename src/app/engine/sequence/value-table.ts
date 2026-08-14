// --- Per-(boxes, focus, fury) value table, one per reachable debuff state -------------------

/** [boxes][focusLeft][furyLeft][shieldGuardsLeft][scapegoatsLeft] -> `[survivalProbability,
 *  expectedBoxesRemaining]` for everything this table represents - a destroyed outcome counts as 0
 *  boxes remaining, matching `SequenceStepResult.expectedBoxesRemaining`'s own convention. Both
 *  numbers are produced together by the SAME backward-induction recursion (see `outcomeScore` in
 *  resource-branches.ts, which is what every decision in this file actually compares on) - keeping
 *  them as one pair per cell, rather than two parallel tables, means every existing consumer only
 *  has to widen its own "value" type from `number` to a 2-tuple, not maintain two synchronized
 *  recursions. Shield Guards/Scapegoats are dense array axes here (like Focus/Fury), not folded
 *  into `tableKey` like Puppet Master/Knowledge of the Damned - see the module doc comment's Shield
 *  Guards/Scapegoats section for why. */
export type ValueTable = [number, number][][][][][];

export function buildValueTable(
  initialBoxes: number,
  maxFocus: number,
  maxFury: number,
  maxShieldGuards: number,
  maxScapegoats: number,
  fill: (boxes: number, focusLeft: number, furyLeft: number, shieldGuardsLeft: number, scapegoatsLeft: number) => [number, number]
): ValueTable {
  const table: ValueTable = [];
  for (let boxes = 0; boxes <= initialBoxes; boxes++) {
    const focusRow: [number, number][][][][] = [];
    for (let focus = 0; focus <= maxFocus; focus++) {
      const furyRow: [number, number][][][] = [];
      for (let fury = 0; fury <= maxFury; fury++) {
        const shieldGuardRow: [number, number][][] = [];
        for (let shieldGuards = 0; shieldGuards <= maxShieldGuards; shieldGuards++) {
          shieldGuardRow[shieldGuards] = [];
          for (let scapegoats = 0; scapegoats <= maxScapegoats; scapegoats++) {
            shieldGuardRow[shieldGuards][scapegoats] = fill(boxes, focus, fury, shieldGuards, scapegoats);
          }
        }
        furyRow[fury] = shieldGuardRow;
      }
      focusRow[focus] = furyRow;
    }
    table[boxes] = focusRow;
  }
  return table;
}

export function readValueTable(
  table: ValueTable,
  boxes: number,
  focusLeft: number,
  furyLeft: number,
  shieldGuardsLeft: number,
  scapegoatsLeft: number
): [number, number] {
  return table[boxes][focusLeft][furyLeft][shieldGuardsLeft][scapegoatsLeft];
}
