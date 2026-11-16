/** 同一天第二次开启时不能覆盖已有周期：日期 id 加了后缀。 */
export function uniqueCycleId(base: string, existing: Array<{ id: string }>): string {
  const ids = new Set(existing.map((c) => c.id));
  if (!ids.has(base)) return base;
  let n = 2;
  while (ids.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}
