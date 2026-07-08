/** Inclusive integer range, used to build <select> option lists. */
export function range(start: number, end: number): number[] {
  const values: number[] = [];
  for (let i = start; i <= end; i++) values.push(i);
  return values;
}
