import type { SegmentCategory, TimerSegment } from '../native/contracts';

export interface CategoryDefinition {
  id: SegmentCategory;
  name: string;
  archived: boolean;
  /** #rrggbb；缺省时界面回退到系统色或按 ID 生成的哈希色。 */
  color?: string;
  /** 只支持两级：null/undefined = 大类，否则指向一个大类。 */
  parentId?: string | null;
}

/** 系统分类：始终保留，不能按普通分类删除。 */
export const PRE_SLEEP_CATEGORY = 'pre-sleep';
export const PRE_SLEEP_DEFAULT_NAME = '睡前时间（待分配）';
export const SYSTEM_CATEGORY_IDS = ['unclassified', 'sleep', PRE_SLEEP_CATEGORY] as const;
/** 名称也锁定的系统分类；睡前时间允许改名。 */
export const FIXED_SYSTEM_CATEGORY_IDS = ['unclassified', 'sleep'] as const;

/** 12 色预置板：新增分类默认取第一个没用过的颜色。 */
export const CATEGORY_PALETTE = [
  '#4c8dff', '#3ddc97', '#2ec4b6', '#9b7bff', '#ff6b9d', '#ff6b5b',
  '#ff9f43', '#ffc44d', '#a3e635', '#38bdf8', '#d946ef', '#8b94a5',
] as const;

/** 系统分类的固定颜色，不随用户色板变化。 */
export const SYSTEM_CATEGORY_COLORS: Record<string, string> = {
  work: '#4c8dff',
  daily: '#3ddc97',
  unclassified: '#8b94a5',
  sleep: '#7a86a8',
  [PRE_SLEEP_CATEGORY]: '#ffb86b',
};

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
}

export function defaultCategories(): CategoryDefinition[] {
  return [
    { id: 'work', name: '工作', archived: false, color: SYSTEM_CATEGORY_COLORS.work, parentId: null },
    { id: 'daily', name: '日常', archived: false, color: SYSTEM_CATEGORY_COLORS.daily, parentId: null },
    { id: 'unclassified', name: '未分类', archived: false, color: SYSTEM_CATEGORY_COLORS.unclassified, parentId: null },
    { id: PRE_SLEEP_CATEGORY, name: PRE_SLEEP_DEFAULT_NAME, archived: false, color: SYSTEM_CATEGORY_COLORS[PRE_SLEEP_CATEGORY], parentId: null },
    { id: 'sleep', name: '补觉', archived: false, color: SYSTEM_CATEGORY_COLORS.sleep, parentId: null },
  ];
}
export function isCategoryId(value: unknown): value is SegmentCategory {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value);
}
export function isSystemCategory(id: string): boolean {
  return SYSTEM_CATEGORY_IDS.some((value) => value === id);
}
export function isFixedSystemCategory(id: string): boolean {
  return FIXED_SYSTEM_CATEGORY_IDS.some((value) => value === id);
}
export function isPreSleepCategory(id: string): boolean {
  return id === PRE_SLEEP_CATEGORY;
}

/** 新分类的颜色：优先用没被占用的预置色，占满后取使用次数最少的。 */
export function defaultColorForNew(catalog: CategoryDefinition[]): string {
  const used = new Set(catalog.map((c) => c.color?.toLowerCase()).filter((color): color is string => !!color));
  const free = CATEGORY_PALETTE.find((color) => !used.has(color));
  if (free) return free;
  const counts = new Map<string, number>(CATEGORY_PALETTE.map((color) => [color, 0]));
  for (const c of catalog) {
    const color = c.color?.toLowerCase();
    if (color && counts.has(color)) counts.set(color, (counts.get(color) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => a[1] - b[1])[0]?.[0] ?? CATEGORY_PALETTE[0];
}

/** 只允许两级：父级必须存在、未停用、本身是大类，且不能是系统分类。 */
export function normalizeCategoryTree(catalog: CategoryDefinition[]): CategoryDefinition[] {
  const result = catalog.map((c) => ({ ...c }));
  const byId = new Map(result.map((c) => [c.id, c]));
  for (const c of result) {
    if (!isHexColor(c.color)) delete c.color;
    if (isSystemCategory(c.id)) {
      c.parentId = null;
      continue;
    }
    const parentId = c.parentId ?? null;
    const parent = parentId ? byId.get(parentId) : null;
    c.parentId = parent
      && parent.id !== c.id
      && !isSystemCategory(parent.id)
      && !parent.parentId
      && !parent.archived
      ? parent.id
      : null;
  }
  return result;
}

export function childrenOf(catalog: CategoryDefinition[], parentId: string): CategoryDefinition[] {
  return catalog.filter((c) => c.parentId === parentId);
}

export function topLevelCategories(catalog: CategoryDefinition[], includeArchived = false): CategoryDefinition[] {
  return catalog.filter((c) => !c.parentId && (includeArchived || !c.archived));
}

/** 展示用路径：子标签显示「大类 / 小类」。 */
export function categoryPath(id: string, catalog: CategoryDefinition[]): string {
  const cat = catalog.find((c) => c.id === id);
  if (!cat) return categoryName(id, catalog);
  const parent = cat.parentId ? catalog.find((c) => c.id === cat.parentId) : null;
  return parent ? `${parent.name} / ${cat.name}` : cat.name;
}

/** 不把合法但未知的 ID 改成未分类：目录丢失时保留引用，等待用户确认名称。 */
export function completeCategories(catalog: CategoryDefinition[], segments: Pick<TimerSegment, 'category'>[]): CategoryDefinition[] {
  const result = catalog.map((c) => ({ ...c }));
  for (const system of defaultCategories().filter((c) => isFixedSystemCategory(c.id))) {
    const index = result.findIndex((c) => c.id === system.id);
    if (index < 0) result.push(system);
    else result[index] = system;
  }
  const preSleep = result.find((c) => c.id === PRE_SLEEP_CATEGORY);
  if (!preSleep) {
    const unclassifiedIndex = result.findIndex((c) => c.id === 'unclassified');
    result.splice(unclassifiedIndex < 0 ? result.length : unclassifiedIndex + 1, 0,
      { id: PRE_SLEEP_CATEGORY, name: PRE_SLEEP_DEFAULT_NAME, archived: false, color: SYSTEM_CATEGORY_COLORS[PRE_SLEEP_CATEGORY], parentId: null });
  } else {
    // 睡前时间是系统标签，但不锁名称：保留用户改过的名字，只强制它始终可用。
    preSleep.archived = false;
    if (!preSleep.name.trim()) preSleep.name = PRE_SLEEP_DEFAULT_NAME;
    if (!isHexColor(preSleep.color)) preSleep.color = SYSTEM_CATEGORY_COLORS[PRE_SLEEP_CATEGORY];
  }
  for (const segment of segments) {
    if (!isCategoryId(segment.category) || result.some((c) => c.id === segment.category)) continue;
    let n = 1;
    while (result.some((c) => c.name === `待确认分类${n}`)) n++;
    result.push({ id: segment.category, name: `待确认分类${n}`, archived: true, parentId: null });
  }
  return normalizeCategoryTree(result);
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
    if (isFixedSystemCategory(c.id)
      && (c.archived || defaultCategories().find((s) => s.id === c.id)?.name !== c.name)) return null;
    // 睡前时间可以改名；旧/异常备份里的 archived 会被 completeCategories 强制改为 false。
    const color = isHexColor(c.color) ? c.color.toLowerCase() : undefined;
    const parentId = isCategoryId(c.parentId) ? c.parentId : null;
    result.push({ id: c.id, name: c.name.trim(), archived: c.archived, ...(color ? { color } : {}), parentId });
  }
  return completeCategories(result, []);
}

export function categoryName(id: string, catalog: CategoryDefinition[] = defaultCategories()): string {
  return catalog.find((c) => c.id === id)?.name ?? `待确认分类（${id}）`;
}

export function selectableCategories(catalog: CategoryDefinition[], originalId?: string, allowSleep = true): CategoryDefinition[] {
  return catalog.filter((c) =>
    (!c.archived || c.id === originalId)
    && (allowSleep || c.id !== 'sleep')
    // 睡前时间只用于系统标记的那一段；普通段不能主动选它。
    && (c.id !== PRE_SLEEP_CATEGORY || c.id === originalId));
}

export function requireSelectableCategory(id: string, originalId: string | undefined, catalog: CategoryDefinition[]): void {
  const c = catalog.find((item) => item.id === id);
  if (!c || (c.archived && id !== originalId)) throw new Error('这个分类已删除或停用，请重新选择');
  if (id === PRE_SLEEP_CATEGORY && originalId !== PRE_SLEEP_CATEGORY) {
    throw new Error('睡前时间只能由系统在开启第二天时标记，请选择一个真实分类');
  }
}

export function validateCategoryName(name: string, catalog: CategoryDefinition[], exceptId?: string): string {
  const trimmed = name.trim();
  if (!trimmed || Array.from(trimmed).length > 12) throw new Error('分类名称需要 1–12 个字');
  if (catalog.some((c) => c.id !== exceptId && c.name === trimmed)) throw new Error('已有同名分类，请换一个名称');
  return trimmed;
}

export type CategoryAction =
  | { kind: 'add'; name: string; id: string; color?: string | null; parentId?: string | null }
  | { kind: 'rename'; id: string; name: string }
  | { kind: 'delete' | 'restore' | 'up' | 'down'; id: string }
  | { kind: 'setColor'; id: string; color: string | null }
  | { kind: 'setParent'; id: string; parentId: string | null };

export function changeCategories(catalog: CategoryDefinition[], action: CategoryAction, referencedIds: Set<string>): CategoryDefinition[] {
  const result = catalog.map((c) => ({ ...c }));
  if (action.kind === 'add') {
    if (!isCategoryId(action.id) || result.some((c) => c.id === action.id)) throw new Error('分类 ID 不合法或已存在');
    const name = validateCategoryName(action.name, result);
    const parent = action.parentId ? result.find((c) => c.id === action.parentId) : null;
    if (action.parentId && (!parent || isSystemCategory(parent.id) || parent.parentId || parent.archived)) {
      throw new Error('只能把新标签放进一个未停用的大类');
    }
    if (action.color !== undefined && action.color !== null && !isHexColor(action.color)) throw new Error('颜色格式不正确');
    const color = action.color ?? defaultColorForNew(result);
    const entry: CategoryDefinition = { id: action.id, name, archived: false, color, parentId: parent?.id ?? null };
    if (parent) {
      const lastChild = result.map((c, i) => ({ c, i })).filter(({ c }) => c.parentId === parent.id).at(-1);
      result.splice(lastChild ? lastChild.i + 1 : result.findIndex((c) => c.id === parent.id) + 1, 0, entry);
    } else {
      result.splice(Math.max(0, result.findIndex((c) => c.id === 'unclassified')), 0, entry);
    }
    return normalizeCategoryTree(result);
  }
  const index = result.findIndex((c) => c.id === action.id);
  if (index < 0) throw new Error('分类已变化，请刷新后重试');
  const current = result[index];
  if (isFixedSystemCategory(current.id)) throw new Error('未分类和补觉是系统类别，不能修改');
  if (isPreSleepCategory(current.id)) {
    if (action.kind !== 'rename') throw new Error('“睡前时间”是系统标签，只能改名，不能删除或停用');
    current.name = validateCategoryName(action.name, result, current.id);
    return normalizeCategoryTree(result);
  }
  if (action.kind === 'rename') current.name = validateCategoryName(action.name, result, current.id);
  else if (action.kind === 'setColor') {
    if (action.color === null) delete current.color;
    else if (!isHexColor(action.color)) throw new Error('颜色格式不正确');
    else current.color = action.color.toLowerCase();
  } else if (action.kind === 'setParent') {
    if (childrenOf(result, current.id).length > 0) throw new Error('这个分类下面还有小标签，先移走或删掉它们');
    if (action.parentId) {
      const parent = result.find((c) => c.id === action.parentId);
      if (!parent || parent.id === current.id || isSystemCategory(parent.id) || parent.parentId || parent.archived) {
        throw new Error('只能归到一个未停用的大类下面');
      }
    }
    current.parentId = action.parentId ?? null;
  } else if (action.kind === 'delete') {
    if (childrenOf(result, current.id).some((c) => !c.archived)) {
      throw new Error('这个大类下面还有小标签，先把它们移走或删掉');
    }
    if (referencedIds.has(current.id)) current.archived = true;
    else result.splice(index, 1);
  } else if (action.kind === 'restore') {
    validateCategoryName(current.name, result, current.id);
    current.archived = false;
  } else {
    const siblings = result.map((c, i) => ({ c, i }))
      .filter(({ c }) => !c.archived && !isSystemCategory(c.id) && (c.parentId ?? null) === (current.parentId ?? null));
    const position = siblings.findIndex(({ c }) => c.id === current.id);
    const other = siblings[position + (action.kind === 'up' ? -1 : 1)];
    if (other) [result[index], result[other.i]] = [result[other.i], result[index]];
  }
  return normalizeCategoryTree(result);
}
