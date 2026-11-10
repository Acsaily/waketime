import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import type { LiveState, TimerSegment } from '../native/contracts';
import { DAY_MS, computeCycle } from '../core/time';
import { categoryOf, repairWakeGap } from '../core/segments';
import { completeCategories, defaultCategories, isCategoryId, parseCategories, type CategoryDefinition } from '../core/categories';

// schema 2 增加类别目录；读取仍兼容 schema 1，未来版本拒绝而不覆盖。
export const SCHEMA_VERSION = 2;
const DATA_FILE = 'waketime/data.json';
const TMP_FILE = 'waketime/data.tmp.json';
const PREV_FILE = 'waketime/data.prev.json';
const BACKUP_DIR = 'waketime/backups';
const LS_KEY = 'waketime.data';
export const APP_VERSION = '0.6.0';

export interface Segment extends TimerSegment {}

export interface SleepMetrics {
  score: number | null;
  reportedTotalMs: number | null;
  note: string | null;
}

export interface Cycle {
  id: string;
  timeZone: string;
  sleepAtMs: number;
  wakeAtMs: number;
  sleepDurationMs: number;
  awakeBudgetMs: number;
  targetAtMs: number;
  sleepMetrics: SleepMetrics;
  screenshotPath: string | null;
  source: 'manual' | 'ocr' | 'backfill';
  session: {
    id: string;
    status: 'running' | 'ended';
    startedAtMs: number;
    segments: Segment[];
  } | null;
  closedAtMs: number | null;
  flags: string[];
  createdAtMs: number;
  updatedAtMs: number;
}

export interface Settings {
  notificationsEnabled: boolean;
  quickNotes: string[];
  categories: CategoryDefinition[];
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
    },
    cycles: [],
  };
}

function normalize(raw: unknown): AppData {
  const d = defaultData();
  const parsed = raw as Partial<AppData>;
  const settings = parsed.settings;
  const cycles = (validateCycles(parsed.cycles) ?? []).map(sanitizeCycle);
  const categories = completeCategories(settings?.categories ? parseCategories(settings.categories)! : defaultCategories(),
    cycles.flatMap((c) => c.session?.segments ?? []));
  return {
    ...d, ...parsed, schemaVersion: SCHEMA_VERSION, appVersion: APP_VERSION,
    settings: {
      notificationsEnabled: typeof settings?.notificationsEnabled === 'boolean' ? settings.notificationsEnabled : d.settings.notificationsEnabled,
      quickNotes: Array.isArray(settings?.quickNotes) ? settings.quickNotes.filter((s): s is string => typeof s === 'string').slice(0, 8) : d.settings.quickNotes,
      categories,
    },
    cycles,
  };
}


function backupStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function writeBackup(text: string): Promise<void> {
  try {
    await ensureDir(BACKUP_DIR);
    // 每次保存一份带时间戳的备份：同一天多次保存不再互相覆盖
    await Filesystem.writeFile({
      path: `${BACKUP_DIR}/data-${backupStamp()}.json`,
      directory: Directory.Data,
      data: text,
      encoding: Encoding.UTF8,
    });
    const listing = await Filesystem.readdir({ path: BACKUP_DIR, directory: Directory.Data });
    const names = listing.files
      .map((f) => (typeof f === 'string' ? f : f.name))
      .filter((n) => n.startsWith('data-') && n.endsWith('.json'))
      .sort()
      .reverse();
    for (const stale of names.slice(20)) {
      await Filesystem.deleteFile({ path: `${BACKUP_DIR}/${stale}`, directory: Directory.Data }).catch(() => undefined);
    }
  } catch {
    // 备份失败不影响主流程
  }
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
export function parseDataText(text: string | null | undefined): AppData | null {
  if (!text || typeof text !== 'string') return null;
  try {
    const raw = JSON.parse(text) as Partial<AppData>;
    if (!raw || typeof raw !== 'object') return null;
    if (raw.schemaVersion !== 1 && raw.schemaVersion !== SCHEMA_VERSION) return null;
    if ((raw.schemaVersion === SCHEMA_VERSION || raw.settings?.categories !== undefined)
      && !parseCategories(raw.settings?.categories)) return null;
    if (!Array.isArray(raw.cycles)) return null;
    // 空记录是合法的新用户状态；非空但结构损坏才拒绝，走恢复路径。
    if (raw.cycles.length > 0 && !validateCycles(raw.cycles)) return null;
    return normalize(raw);
  } catch {
    return null;
  }
}

/** 从候选里挑第一个可用且有内容的（纯函数，便于单测） */
export function pickRecoveredData(
  candidates: Array<{ name: string; text: string | null }>
): { name: string; data: AppData } | null {
  for (const candidate of candidates) {
    const data = parseDataText(candidate.text);
    if (data && data.cycles.length > 0) return { name: candidate.name, data };
  }
  return null;
}

async function readText(path: string): Promise<string | null> {
  try {
    const res = await Filesystem.readFile({ path, directory: Directory.Data, encoding: Encoding.UTF8 });
    return typeof res.data === 'string' ? res.data : '';
  } catch (e) {
    if (/not exist|not found|ENOENT|no such file/i.test(String(e))) return null;
    throw new DataCorruptError('数据文件无法读取，已停止保存：' + String(e), [path]);
  }
}

async function ensureDir(path: string): Promise<void> {
  try {
    await Filesystem.mkdir({ path, directory: Directory.Data, recursive: true });
  } catch (e) {
    // Capacitor 的 mkdir 对"已存在目录"也会抛错；这里只忽略这一种，
    // 其它错误交给后续 writeFile 暴露（真写不进去时一定会抛）。
    const msg = String(e);
    if (!/already exists|cannot be overwritten/i.test(msg)) throw e;
  }
}
async function writeText(path: string, text: string): Promise<void> {
  await Filesystem.writeFile({ path, directory: Directory.Data, data: text, encoding: Encoding.UTF8 });
}

/** 恢复候选：上次好数据 → 临时文件 → 最近几份每日备份 */
async function recoveryCandidates(): Promise<Array<{ name: string; path: string }>> {
  const out: Array<{ name: string; path: string }> = [
    { name: 'data.prev.json', path: PREV_FILE },
    { name: 'data.tmp.json', path: TMP_FILE },
  ];
  try {
    const listing = await Filesystem.readdir({ path: BACKUP_DIR, directory: Directory.Data });
    const names = listing.files
      .map((f) => (typeof f === 'string' ? f : f.name))
      .filter((n) => n.startsWith('data-') && n.endsWith('.json'))
      .sort()
      .reverse()
      .slice(0, 20);
    for (const n of names) out.push({ name: `backups/${n}`, path: `${BACKUP_DIR}/${n}` });
  } catch {
    // 没有备份目录
  }
  return out;
}

/** 主文件来自未来版本时，不能回退旧备份后再覆盖它。 */
export function rejectFutureSchema(text: string | null): void {
  if (!text) return;
  try {
    const raw = JSON.parse(text);
    if (raw && typeof raw.schemaVersion === 'number' && raw.schemaVersion > SCHEMA_VERSION) {
      throw new DataCorruptError('数据来自更新版本，已停止保存；请使用对应版本的 App，不要降级覆盖', [DATA_FILE]);
    }
  } catch (e) { if (e instanceof DataCorruptError) throw e; }
}

export async function loadData(): Promise<LoadResult> {
  if (!Capacitor.isNativePlatform()) {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return { data: defaultData(), recoveredFrom: null };
    rejectFutureSchema(raw);
    const parsed = parseDataText(raw);
    if (parsed) return { data: parsed, recoveredFrom: null };
    throw new DataCorruptError('本地数据解析失败', ['localStorage']);
  }

  const primary = await readText(DATA_FILE);
  rejectFutureSchema(primary);
  const primaryData = parseDataText(primary);
  if (primaryData) return { data: primaryData, recoveredFrom: null };

  const candidates = await recoveryCandidates();
  const texts: Array<{ name: string; text: string | null }> = [];
  for (const c of candidates) {
    // 候选文件读不了就跳过，单个坏候选不阻断其余恢复路径。
    try {
      texts.push({ name: c.name, text: await readText(c.path) });
    } catch {
      texts.push({ name: c.name, text: null });
    }
  }
  const picked = pickRecoveredData(texts);
  if (picked) return { data: picked.data, recoveredFrom: picked.name };

  // 主文件不存在 = 新用户；主文件存在但解析不了且无备份 = 报错（不覆盖，等用户处理/导出排查）
  if (primary === null) return { data: defaultData(), recoveredFrom: null };
  throw new DataCorruptError(
    '主数据文件损坏，且没有找到可用备份（数据仍保留在 data.prev.json / data.tmp.json / backups 里，请不要卸载）',
    ['data.json', ...candidates.map((c) => c.name)]
  );
}

let saveChain: Promise<void> = Promise.resolve();

/**
 * 安全写盘（Capacitor 没有 fsync / 原子 rename 保证，所以用"三份文件"兜底）：
 * 1. 先写 data.tmp.json 并回读校验，保证新内容完整
 * 2. 把当前 data.json 复制一份到 data.prev.json（读+写，绝不先删主文件）
 * 3. 直接覆盖写 data.json，写完回读校验；失败则用 tmp 重写一次
 * 任何一步被系统杀掉：主文件要么是旧的好数据，要么是新数据；坏了也能从 prev/tmp/备份恢复。
 */
async function doSave(data: AppData): Promise<void> {
  const text = JSON.stringify(data);
  if (!Capacitor.isNativePlatform()) {
    rejectFutureSchema(window.localStorage.getItem(LS_KEY));
    window.localStorage.setItem(LS_KEY, text);
    return;
  }
  await ensureDir('waketime');
  rejectFutureSchema(await readText(DATA_FILE));

  await writeText(TMP_FILE, text);
  if (!parseDataText(await readText(TMP_FILE))) {
    throw new Error('临时数据文件校验失败（未改动主文件）');
  }

  const current = await readText(DATA_FILE);
  if (current) {
    try {
      await writeText(PREV_FILE, current);
    } catch {
      // 上一份备份失败不阻塞主流程：tmp 里还有最新一份
    }
  }

  await writeText(DATA_FILE, text);
  if (!parseDataText(await readText(DATA_FILE))) {
    // 主文件写坏了：立刻用 tmp 再兜一次
    await writeText(DATA_FILE, text);
    if (!parseDataText(await readText(DATA_FILE))) {
      throw new Error('主数据文件写入校验失败（可从 data.prev.json 恢复）');
    }
  }
  void writeBackup(text);
}

/** 串行写入，避免并发保存互相覆盖 */
export function saveData(data: AppData): Promise<void> {
  saveChain = saveChain.catch(() => undefined).then(() => doSave(data));
  return saveChain;
}

/** 段清洗：同 id 去重（优先保留合法版本）、丢掉 end<=start 的负时长段、按开始时间排序 */
export function sanitizeSegments(segments: Segment[]): Segment[] {
  const byId = new Map<string, Segment>();
  for (const seg of segments) {
    if (!seg || typeof seg.id !== 'string' || !seg.id) continue;
    if (!Number.isFinite(seg.startAtMs)) continue;
    const valid = seg.endAtMs === 0 || seg.endAtMs > seg.startAtMs;
    const prev = byId.get(seg.id);
    const prevValid = prev ? prev.endAtMs === 0 || prev.endAtMs > prev.startAtMs : false;
    if (!prev || (valid && !prevValid)) byId.set(seg.id, { ...seg, note: typeof seg.note === 'string' ? seg.note : '', category: categoryOf(seg) });
  }
  return [...byId.values()]
    .filter((s) => s.endAtMs === 0 || s.endAtMs > s.startAtMs)
    .sort((a, b) => a.startAtMs - b.startAtMs);
}

/** 旧数据自愈：把一天里所有段洗干净 */
export function sanitizeCycle(cycle: Cycle): Cycle {
  if (!cycle.session) return cycle;
  const segments = repairWakeGap(sanitizeSegments(cycle.session.segments ?? []), cycle.wakeAtMs, cycle.id);
  if (segments.length === (cycle.session.segments ?? []).length) {
    // 数量没变也可能顺序/内容变了，这里统一返回新对象，保证调用方拿到干净数据
  }
  return { ...cycle, session: { ...cycle.session, segments } };
}

/** 把原生 live 状态镜像进 data.json（原生是 live 的唯一真相来源）
 *
 * 关键：原生返回的是"当天累计的段"（restartSession 也保留旧段），所以这里永远用它
 * **整份替换**，不能再和 prev 里的段拼接——之前拼接导致每次刷新都复制一遍历史，
 * 并且把旧段用更早的时间封口，产生 end<start 的负时长段。
 */
export function applyLiveState(data: AppData, live: LiveState, nowMs: number): AppData {
  if (!live || live.status === 'idle' || !live.cycleId) return data;
  const derived = computeCycle({ sleepAtMs: live.sleepAtMs, wakeAtMs: live.wakeAtMs });
  const prev = data.cycles.find((c) => c.id === live.cycleId);
  const cycle: Cycle = {
    id: live.cycleId,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    sleepAtMs: live.sleepAtMs,
    wakeAtMs: live.wakeAtMs,
    ...derived,
    sleepMetrics: prev?.sleepMetrics ?? { score: null, reportedTotalMs: null, note: null },
    screenshotPath: prev?.screenshotPath ?? null,
    source: prev?.source ?? 'manual',
    session: {
      id: live.sessionId,
      status: live.status === 'ended' ? 'ended' : 'running',
      startedAtMs: live.sessionStartedAtMs,
      segments: repairWakeGap(sanitizeSegments(live.segments.map((s) => ({ ...s }))), live.wakeAtMs, live.cycleId),
    },
    closedAtMs: null,
    flags: live.clockAnomaly ? Array.from(new Set([...(prev?.flags ?? []), 'clock_anomaly'])) : prev?.flags ?? [],
    createdAtMs: prev?.createdAtMs ?? nowMs,
    updatedAtMs: nowMs,
  };

  // 新周期比旧周期晚：把旧周期关掉（结束时间 = 新周期的入睡时刻），
  // 同时封口旧会话里没结束的段，否则历史里会留下一个永远“进行中”的段。
  const cycles = data.cycles
    .filter((c) => c.id !== cycle.id)
    .map((c) => {
      if (c.closedAtMs !== null || c.wakeAtMs >= live.sleepAtMs) return c;
      const segs = (c.session?.segments ?? []).map((s) =>
        s.endAtMs === 0 ? { ...s, endAtMs: Math.max(s.startAtMs, live.sleepAtMs) } : { ...s }
      );
      return {
        ...c,
        closedAtMs: live.sleepAtMs,
        session: c.session ? { ...c.session, status: 'ended' as const, segments: segs } : null,
        updatedAtMs: nowMs,
      };
    });

  const sorted = [...cycles, cycle].sort((a, b) => b.wakeAtMs - a.wakeAtMs);
  return { ...data, settings: { ...data.settings, categories: completeCategories(data.settings.categories,
    sorted.flatMap((c) => c.session?.segments ?? [])) }, cycles: sorted };
}

export function updateCycle(data: AppData, cycleId: string, patch: Partial<Cycle>, nowMs: number): AppData {
  return {
    ...data,
    cycles: data.cycles.map((c) => (c.id === cycleId ? { ...c, ...patch, updatedAtMs: nowMs } : c)),
  };
}

export function closeCycle(data: AppData, cycleId: string, closedAtMs: number): AppData {
  return updateCycle(data, cycleId, { closedAtMs }, Date.now());
}

/** 校验从备份文件里读出来的 cycles（结构、类型、时间不变式） */
export function validateCycles(input: unknown): Cycle[] | null {
  if (!Array.isArray(input)) return null;
  const out: Cycle[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') return null;
    const c = raw as Partial<Cycle>;
    if (typeof c.id !== 'string' || !c.id) return null;
    if (!Number.isFinite(c.sleepAtMs) || !Number.isFinite(c.wakeAtMs)) return null;
    if ((c.wakeAtMs as number) <= (c.sleepAtMs as number)) return null;
    if (out.some((existing) => existing.id === c.id)) return null;
    if (c.closedAtMs != null && (!Number.isFinite(c.closedAtMs) || c.closedAtMs < (c.wakeAtMs as number))) return null;
    if (c.session != null) {
      if (!Array.isArray(c.session.segments) || !['running', 'ended'].includes(c.session.status)) return null;
      for (const s of c.session.segments) {
        if (!s || typeof s.id !== 'string' || !Number.isFinite(s.startAtMs) || !Number.isFinite(s.endAtMs)) return null;
        if (s.category !== undefined && !isCategoryId(s.category)) return null;
        if (s.splitFromId !== undefined && (typeof s.splitFromId !== 'string' || !s.splitFromId)) return null;
      }
    }
    out.push(sanitizeCycle({
      id: c.id,
      timeZone: typeof c.timeZone === 'string' ? c.timeZone : Intl.DateTimeFormat().resolvedOptions().timeZone,
      sleepAtMs: c.sleepAtMs as number,
      wakeAtMs: c.wakeAtMs as number,
      sleepDurationMs: Number.isFinite(c.sleepDurationMs) ? (c.sleepDurationMs as number) : (c.wakeAtMs as number) - (c.sleepAtMs as number),
      awakeBudgetMs: Number.isFinite(c.awakeBudgetMs) ? (c.awakeBudgetMs as number) : DAY_MS - ((c.wakeAtMs as number) - (c.sleepAtMs as number)),
      targetAtMs: Number.isFinite(c.targetAtMs) ? (c.targetAtMs as number) : (c.sleepAtMs as number) + DAY_MS,
      sleepMetrics: c.sleepMetrics ?? { score: null, reportedTotalMs: null, note: null },
      screenshotPath: c.screenshotPath ?? null,
      source: c.source ?? 'manual',
      session: c.session ?? null,
      closedAtMs: c.closedAtMs ?? null,
      flags: Array.isArray(c.flags) ? c.flags : [],
      createdAtMs: Number.isFinite(c.createdAtMs) ? (c.createdAtMs as number) : Date.now(),
      updatedAtMs: Number.isFinite(c.updatedAtMs) ? (c.updatedAtMs as number) : Date.now(),
    }));
  }
  return out;
}
