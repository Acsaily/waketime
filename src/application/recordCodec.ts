import { DAY_MS, sanitizeCycle, type Cycle } from '../modules/time-tracking/index';
import {
  completeCategories,
  defaultCategories,
  isCategoryId,
  parseCategories,
  type CategoryDefinition,
} from '../modules/classification/index';

// schema 3 增加分类颜色与两级父子关系；读取仍兼容 schema 1/2，未来版本拒绝而不覆盖。
export const SCHEMA_VERSION = 3;
export const APP_VERSION = '0.9.0';

export interface Settings {
  notificationsEnabled: boolean;
  quickNotes: string[];
  categories: CategoryDefinition[];
  /** 分段工具与计次的触感/音效；旧数据没有字段时默认开启。 */
  hapticsEnabled: boolean;
  soundEnabled: boolean;
}

export interface AppData {
  schemaVersion: number;
  appVersion: string;
  settings: Settings;
  cycles: Cycle[];
}

export function defaultData(): AppData {
  return {
    schemaVersion: SCHEMA_VERSION,
    appVersion: APP_VERSION,
    settings: {
      notificationsEnabled: true,
      quickNotes: ['工作', '吃饭', '休息', '刷手机'],
      categories: defaultCategories(),
      hapticsEnabled: true,
      soundEnabled: true,
    },
    cycles: [],
  };
}

function normalize(raw: unknown, now: () => number): AppData {
  const d = defaultData();
  const parsed = raw as Partial<AppData>;
  const settings = parsed.settings;
  const cycles = (validateCycles(parsed.cycles, now) ?? []).map(sanitizeCycle);
  const categories = completeCategories(
    settings?.categories ? parseCategories(settings.categories)! : defaultCategories(),
    cycles.flatMap((c) => c.session?.segments ?? []),
  );
  return {
    ...d,
    ...parsed,
    schemaVersion: SCHEMA_VERSION,
    appVersion: APP_VERSION,
    settings: {
      notificationsEnabled:
        typeof settings?.notificationsEnabled === 'boolean'
          ? settings.notificationsEnabled
          : d.settings.notificationsEnabled,
      quickNotes: Array.isArray(settings?.quickNotes)
        ? settings.quickNotes.filter((s): s is string => typeof s === 'string').slice(0, 8)
        : d.settings.quickNotes,
      categories,
      hapticsEnabled:
        typeof settings?.hapticsEnabled === 'boolean'
          ? settings.hapticsEnabled
          : d.settings.hapticsEnabled,
      soundEnabled:
        typeof settings?.soundEnabled === 'boolean'
          ? settings.soundEnabled
          : d.settings.soundEnabled,
    },
    cycles,
  };
}

export class DataCorruptError extends Error {
  tried: string[];

  constructor(message: string, tried: string[] = []) {
    super(message);
    this.tried = tried;
  }
}

export interface LoadResult {
  data: AppData;
  /** 非 null 表示主文件坏了，是从这个候选恢复的 */
  recoveredFrom: string | null;
}

/** 解析一份数据文本；结构不合法返回 null（恢复候选校验用，不抛错） */
export function parseDataText(
  text: string | null | undefined,
  now: () => number = Date.now,
): AppData | null {
  if (!text || typeof text !== 'string') return null;
  try {
    const raw = JSON.parse(text) as Partial<AppData>;
    if (!raw || typeof raw !== 'object') return null;
    if (raw.schemaVersion !== 1 && raw.schemaVersion !== 2 && raw.schemaVersion !== SCHEMA_VERSION)
      return null;
    if (
      (raw.schemaVersion === SCHEMA_VERSION || raw.settings?.categories !== undefined) &&
      !parseCategories(raw.settings?.categories)
    )
      return null;
    if (!Array.isArray(raw.cycles)) return null;
    // 空记录是合法的新用户状态；非空但结构损坏才拒绝，走恢复路径。
    if (raw.cycles.length > 0 && !validateCycles(raw.cycles, now)) return null;
    return normalize(raw, now);
  } catch {
    return null;
  }
}

/** 从候选里挑第一个可用且有内容的（纯函数，便于单测） */
export function pickRecoveredData(
  candidates: Array<{ name: string; text: string | null }>,
  now: () => number = Date.now,
): { name: string; data: AppData } | null {
  for (const candidate of candidates) {
    const data = parseDataText(candidate.text, now);
    if (data && data.cycles.length > 0) return { name: candidate.name, data };
  }
  return null;
}

/** 主文件来自未来版本时，不能回退旧备份后再覆盖它。 */
export function rejectFutureSchema(text: string | null): void {
  if (!text) return;
  try {
    const raw = JSON.parse(text);
    if (raw && typeof raw.schemaVersion === 'number' && raw.schemaVersion > SCHEMA_VERSION) {
      throw new DataCorruptError(
        '数据来自更新版本，已停止保存；请使用对应版本的 App，不要降级覆盖',
        ['waketime/data.json'],
      );
    }
  } catch (e) {
    if (e instanceof DataCorruptError) throw e;
  }
}

/** 校验从备份文件里读出来的 cycles（结构、类型、时间不变式） */
export function validateCycles(input: unknown, now: () => number = Date.now): Cycle[] | null {
  if (!Array.isArray(input)) return null;
  const out: Cycle[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') return null;
    const c = raw as Partial<Cycle>;
    if (typeof c.id !== 'string' || !c.id) return null;
    if (!Number.isFinite(c.sleepAtMs) || !Number.isFinite(c.wakeAtMs)) return null;
    if ((c.wakeAtMs as number) <= (c.sleepAtMs as number)) return null;
    if (out.some((existing) => existing.id === c.id)) return null;
    if (
      c.closedAtMs != null &&
      (!Number.isFinite(c.closedAtMs) || c.closedAtMs < (c.wakeAtMs as number))
    )
      return null;
    if (c.session != null) {
      if (!Array.isArray(c.session.segments) || !['running', 'ended'].includes(c.session.status))
        return null;
      for (const s of c.session.segments) {
        if (
          !s ||
          typeof s.id !== 'string' ||
          !Number.isFinite(s.startAtMs) ||
          !Number.isFinite(s.endAtMs)
        )
          return null;
        if (s.category !== undefined && !isCategoryId(s.category)) return null;
        if (s.splitFromId !== undefined && (typeof s.splitFromId !== 'string' || !s.splitFromId))
          return null;
      }
    }
    out.push(
      sanitizeCycle({
        id: c.id,
        timeZone:
          typeof c.timeZone === 'string'
            ? c.timeZone
            : Intl.DateTimeFormat().resolvedOptions().timeZone,
        sleepAtMs: c.sleepAtMs as number,
        wakeAtMs: c.wakeAtMs as number,
        sleepDurationMs: Number.isFinite(c.sleepDurationMs)
          ? (c.sleepDurationMs as number)
          : (c.wakeAtMs as number) - (c.sleepAtMs as number),
        awakeBudgetMs: Number.isFinite(c.awakeBudgetMs)
          ? (c.awakeBudgetMs as number)
          : DAY_MS - ((c.wakeAtMs as number) - (c.sleepAtMs as number)),
        targetAtMs: Number.isFinite(c.targetAtMs)
          ? (c.targetAtMs as number)
          : (c.sleepAtMs as number) + DAY_MS,
        sleepMetrics: c.sleepMetrics ?? { score: null, reportedTotalMs: null, note: null },
        screenshotPath: c.screenshotPath ?? null,
        source: c.source ?? 'manual',
        session: c.session ?? null,
        closedAtMs: c.closedAtMs ?? null,
        flags: Array.isArray(c.flags) ? c.flags : [],
        createdAtMs: Number.isFinite(c.createdAtMs) ? (c.createdAtMs as number) : now(),
        updatedAtMs: Number.isFinite(c.updatedAtMs) ? (c.updatedAtMs as number) : now(),
      }),
    );
  }
  return out;
}
