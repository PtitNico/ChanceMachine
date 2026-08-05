// --- Per-(boxes, focus, fury) value table, one per reachable debuff state -------------------

/** [boxes][focusLeft][furyLeft][shieldGuardsLeft][scapegoatsLeft] -> probability of surviving
 *  everything this table represents. Shield Guards/Scapegoats are dense array axes here (like
 *  Focus/Fury), not folded into `tableKey` like Puppet Master/Knowledge of the Damned - see the
 *  module doc comment's Shield Guards/Scapegoats section for why. */
export type ValueTable = number[][][][][];

export function buildValueTable(
  initialBoxes: number,
  maxFocus: number,
  maxFury: number,
  maxShieldGuards: number,
  maxScapegoats: number,
  fill: (boxes: number, focusLeft: number, furyLeft: number, shieldGuardsLeft: number, scapegoatsLeft: number) => number
): ValueTable {
  const table: ValueTable = [];
  for (let boxes = 0; boxes <= initialBoxes; boxes++) {
    const focusRow: number[][][][] = [];
    for (let focus = 0; focus <= maxFocus; focus++) {
      const furyRow: number[][][] = [];
      for (let fury = 0; fury <= maxFury; fury++) {
        const shieldGuardRow: number[][] = [];
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
): number {
  return table[boxes][focusLeft][furyLeft][shieldGuardsLeft][scapegoatsLeft];
}
