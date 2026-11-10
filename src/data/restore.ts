import { completeCategories, isSystemCategory, type CategoryDefinition } from '../core/categories';
import { parseDataText, type AppData, type Cycle } from './store';

export interface RestoreBackup {
  cycles: Cycle[];
  categories: CategoryDefinition[];
}
export type RestoreMode = 'overwrite' | 'merge';
export type CategoryResolutions = Record<string, 'local' | 'backup'>;
export interface CategoryConflict { id: string; local: CategoryDefinition; backup: CategoryDefinition }

export function readRestoreBackup(input: unknown): RestoreBackup {
  // 兼容旧的纯周期数组；有 schema 的文件必须严格按支持的版本校验。
  const raw = Array.isArray(input) ? { schemaVersion: 1, cycles: input } : input;
  const parsed = parseDataText(JSON.stringify(raw));
  if (!parsed) throw new Error('备份结构、分类目录或版本不兼容，没有改动任何数据');
  return { cycles: parsed.cycles, categories: parsed.settings.categories };
}

export function categoryConflicts(local: CategoryDefinition[], backup: CategoryDefinition[]): CategoryConflict[] {
  return backup.flatMap((b) => {
    const a = local.find((c) => c.id === b.id);
    return a && !isSystemCategory(b.id) && (a.name !== b.name || a.archived !== b.archived)
      ? [{ id: b.id, local: a, backup: b }] : [];
  });
}

/** 先在隔离对象中完成校验和冲突处理，调用方安全写盘后才发布。 */
export function buildRestoredData(current: AppData, backup: RestoreBackup, mode: RestoreMode,
  resolutions: CategoryResolutions = {}, protectedCycleId?: string): AppData {
  if (mode === 'overwrite' && !backup.cycles.length && current.cycles.length) {
    throw new Error('备份没有周期记录，只能合并分类，不能用它清空现有记录');
  }
  const conflicts = categoryConflicts(current.settings.categories, backup.categories);
  if (conflicts.some((c) => !['local', 'backup'].includes(resolutions[c.id]))) {
    throw new Error('请先确认每个冲突分类使用本机还是备份的名称与停用状态');
  }
  const categories = current.settings.categories.map((c) => ({ ...c }));
  for (const incoming of backup.categories) {
    const index = categories.findIndex((c) => c.id === incoming.id);
    if (index < 0) categories.push({ ...incoming });
    else if (!conflicts.some((c) => c.id === incoming.id) || resolutions[incoming.id] === 'backup') categories[index] = { ...incoming };
  }
  const map = new Map((mode === 'merge' ? current.cycles : current.cycles.filter((c) => c.id === protectedCycleId)).map((c) => [c.id, c]));
  for (const cycle of backup.cycles) {
    if (cycle.id !== protectedCycleId) map.set(cycle.id, cycle);
  }
  const cycles = [...map.values()].sort((a, b) => b.wakeAtMs - a.wakeAtMs);
  return { ...current, settings: { ...current.settings,
    categories: completeCategories(categories, cycles.flatMap((c) => c.session?.segments ?? [])) }, cycles };
}
