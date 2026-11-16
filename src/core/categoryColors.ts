import { CATEGORY_PALETTE, SYSTEM_CATEGORY_COLORS, type CategoryDefinition } from './categories';

export { CATEGORY_PALETTE };

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

/** 优先用分类自己保存的颜色，其次系统固定色，最后按稳定 ID 生成的颜色。 */
export function categoryColor(id: string, catalog?: CategoryDefinition[]): string {
  const saved = catalog?.find((c) => c.id === id)?.color;
  if (saved) return saved;
  if (SYSTEM_CATEGORY_COLORS[id]) return SYSTEM_CATEGORY_COLORS[id];
  return `hsl(${Math.round(hash(id) * 360)} 62% 62%)`;
}
