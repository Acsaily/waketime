import type { SegmentCategory, TimerSegment } from '../native/contracts';

export interface CategoryDefinition {
  id: SegmentCategory;
  name: string;
  archived: boolean;
}

export const SYSTEM_CATEGORY_IDS = ['unclassified', 'sleep'] as const;
export function defaultCategories(): CategoryDefinition[] {
  return [
    { id: 'work', name: '工作', archived: false },
    { id: 'daily', name: '日常', archived: false },
    { id: 'unclassified', name: '未分类', archived: false },
    { id: 'sleep', name: '补觉', archived: false },
  ];
}
export function isCategoryId(value: unknown): value is SegmentCategory {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value);
}
export function isSystemCategory(id: string): boolean {
  return SYSTEM_CATEGORY_IDS.some((value) => value === id);
}

/** 不把合法但未知的 ID 改成未分类：目录丢失时保留引用，等待用户确认名称。 */
export function completeCategories(catalog: CategoryDefinition[], segments: Pick<TimerSegment, 'category'>[]): CategoryDefinition[] {
  const result = catalog.map((c) => ({ ...c }));
  for (const system of defaultCategories().filter((c) => isSystemCategory(c.id))) {
    const index = result.findIndex((c) => c.id === system.id);
    if (index < 0) result.push(system);
    else result[index] = system;
  }
  for (const segment of segments) {
    if (!isCategoryId(segment.category) || result.some((c) => c.id === segment.category)) continue;
    let n = 1;
    while (result.some((c) => c.name === `待确认分类${n}`)) n++;
    result.push({ id: segment.category, name: `待确认分类${n}`, archived: true });
  }
  return result;
}

export function parseCategories(value: unknown): CategoryDefinition[] | null {
  if (!Array.isArray(value)) return null;
  const result: CategoryDefinition[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') return null;
    const c = item as Partial<CategoryDefinition>;
    if (!isCategoryId(c.id) || typeof c.name !== 'string' || !c.name.trim()
      || Array.from(c.name).length > 12 || typeof c.archived !== 'boolean'
      || result.some((other) => other.id === c.id)) return null;
    if (isSystemCategory(c.id) && (c.archived || defaultCategories().find((s) => s.id === c.id)?.name !== c.name)) return null;
    result.push({ id: c.id, name: c.name.trim(), archived: c.archived });
  }
  return completeCategories(result, []);
}

export function categoryName(id: string, catalog: CategoryDefinition[] = defaultCategories()): string {
  return catalog.find((c) => c.id === id)?.name ?? `待确认分类（${id}）`;
}

export function selectableCategories(catalog: CategoryDefinition[], originalId?: string, allowSleep = true): CategoryDefinition[] {
  return catalog.filter((c) => (!c.archived || c.id === originalId) && (allowSleep || c.id !== 'sleep'));
}

export function requireSelectableCategory(id: string, originalId: string | undefined, catalog: CategoryDefinition[]): void {
  const c = catalog.find((item) => item.id === id);
  if (!c || (c.archived && id !== originalId)) throw new Error('这个分类已删除或停用，请重新选择');
}

export function validateCategoryName(name: string, catalog: CategoryDefinition[], exceptId?: string): string {
  const trimmed = name.trim();
  if (!trimmed || Array.from(trimmed).length > 12) throw new Error('分类名称需要 1–12 个字');
  if (catalog.some((c) => c.id !== exceptId && c.name === trimmed)) throw new Error('已有同名分类，请换一个名称');
  return trimmed;
}

export type CategoryAction =
  | { kind: 'add'; name: string; id: string }
  | { kind: 'rename'; id: string; name: string }
  | { kind: 'delete' | 'restore' | 'up' | 'down'; id: string };

export function changeCategories(catalog: CategoryDefinition[], action: CategoryAction, referencedIds: Set<string>): CategoryDefinition[] {
  const result = catalog.map((c) => ({ ...c }));
  if (action.kind === 'add') {
    if (!isCategoryId(action.id) || result.some((c) => c.id === action.id)) throw new Error('分类 ID 不合法或已存在');
    const name = validateCategoryName(action.name, result);
    result.splice(Math.max(0, result.findIndex((c) => c.id === 'unclassified')), 0, { id: action.id, name, archived: false });
    return result;
  }
  const index = result.findIndex((c) => c.id === action.id);
  if (index < 0) throw new Error('分类已变化，请刷新后重试');
  const current = result[index];
  if (isSystemCategory(current.id)) throw new Error('未分类和补觉是系统类别，不能修改');
  if (action.kind === 'rename') current.name = validateCategoryName(action.name, result, current.id);
  else if (action.kind === 'delete') {
    if (referencedIds.has(current.id)) current.archived = true;
    else result.splice(index, 1);
  } else if (action.kind === 'restore') {
    validateCategoryName(current.name, result, current.id);
    current.archived = false;
  } else {
    const candidates = result.map((c, i) => ({ c, i })).filter(({ c }) => !c.archived && !isSystemCategory(c.id));
    const position = candidates.findIndex(({ c }) => c.id === current.id);
    const other = candidates[position + (action.kind === 'up' ? -1 : 1)];
    if (other) [result[index], result[other.i]] = [result[other.i], result[index]];
  }
  return result;
}
