/** <select> change events always carry a string - this converts back to a number. */
export function toNumber(raw: string): number {
  return Number(raw);
}
