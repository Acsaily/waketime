import {
  defaultData,
  DataCorruptError,
  parseDataText,
  pickRecoveredData,
  rejectFutureSchema,
  type AppData,
  type LoadResult,
  type RecordStorePort,
} from '../application/index';

/** Text-file primitives; the store owns write order and recovery policy. */
export interface RecordFileSystem {
  read(path: string): Promise<string | null>;
  write(path: string, text: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  list(path: string): Promise<string[]>;
  remove(path: string): Promise<void>;
}
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
const DATA_FILE = 'waketime/data.json';
const TMP_FILE = 'waketime/data.tmp.json';
const PREV_FILE = 'waketime/data.prev.json';
const BACKUP_DIR = 'waketime/backups';
const LS_KEY = 'waketime.data';

export function createBrowserRecordStore(
  storage: KeyValueStorage,
  now: () => number = Date.now,
): RecordStorePort {
  let saveChain: Promise<void> = Promise.resolve();
  return {
    async load() {
      const raw = storage.getItem(LS_KEY);
      if (!raw) return { data: defaultData(), recoveredFrom: null };
      rejectFutureSchema(raw);
      const parsed = parseDataText(raw, now);
      if (parsed) return { data: parsed, recoveredFrom: null };
      throw new DataCorruptError('本地数据解析失败', ['localStorage']);
    },
    save(data) {
      saveChain = saveChain
        .catch(() => undefined)
        .then(() => {
          rejectFutureSchema(storage.getItem(LS_KEY));
          storage.setItem(LS_KEY, JSON.stringify(data));
        });
      return saveChain;
    },
  };
}

export function createRecordStore(
  fs: RecordFileSystem,
  now: () => number = Date.now,
): RecordStorePort {
  function backupStamp(): string {
    const d = new Date(now());
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  }

  async function writeBackup(text: string): Promise<void> {
    try {
      await ensureDir(BACKUP_DIR);
      // 秒级文件名；同秒保存覆盖，保留最近 20 份（保持旧版行为）
      await fs.write(`${BACKUP_DIR}/data-${backupStamp()}.json`, text);
      const names = (await fs.list(BACKUP_DIR))
        .filter((n) => n.startsWith('data-') && n.endsWith('.json'))
        .sort()
        .reverse();
      for (const stale of names.slice(20)) {
        await fs.remove(`${BACKUP_DIR}/${stale}`).catch(() => undefined);
      }
    } catch {
      // 备份失败不影响主流程
    }
  }

  async function readText(path: string): Promise<string | null> {
    try {
      return await fs.read(path);
    } catch (e) {
      if (/not exist|not found|ENOENT|no such file/i.test(String(e))) return null;
      throw new DataCorruptError('数据文件无法读取，已停止保存：' + String(e), [path]);
    }
  }

  async function ensureDir(path: string): Promise<void> {
    try {
      await fs.mkdir(path);
    } catch (e) {
      // Capacitor 的 mkdir 对"已存在目录"也会抛错；这里只忽略这一种，
      // 其它错误交给后续 writeFile 暴露（真写不进去时一定会抛）。
      const msg = String(e);
      if (!/already exists|cannot be overwritten/i.test(msg)) throw e;
    }
  }
  async function writeText(path: string, text: string): Promise<void> {
    await fs.write(path, text);
  }

  /** 恢复候选：上次好数据 → 临时文件 → 最近几份每日备份 */
  async function recoveryCandidates(): Promise<Array<{ name: string; path: string }>> {
    const out: Array<{ name: string; path: string }> = [
      { name: 'data.prev.json', path: PREV_FILE },
      { name: 'data.tmp.json', path: TMP_FILE },
    ];
    try {
      const names = (await fs.list(BACKUP_DIR))
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

  async function load(): Promise<LoadResult> {
    const primary = await readText(DATA_FILE);
    rejectFutureSchema(primary);
    const primaryData = parseDataText(primary, now);
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
    const picked = pickRecoveredData(texts, now);
    if (picked) return { data: picked.data, recoveredFrom: picked.name };

    // 主文件不存在 = 新用户；主文件存在但解析不了且无备份 = 报错（不覆盖，等用户处理/导出排查）
    if (primary === null) return { data: defaultData(), recoveredFrom: null };
    throw new DataCorruptError(
      '主数据文件损坏，且没有找到可用备份（数据仍保留在 data.prev.json / data.tmp.json / backups 里，请不要卸载）',
      ['data.json', ...candidates.map((c) => c.name)],
    );
  }

  let saveChain: Promise<void> = Promise.resolve();

  /**
   * 安全写盘（Capacitor 没有 fsync / 原子 rename 保证，所以用"三份文件"兜底）：
   * 1. 先写 data.tmp.json 并回读校验，保证新内容完整
   * 2. 把当前 data.json 复制一份到 data.prev.json（读+写，绝不先删主文件）
   * 3. 直接覆盖写 data.json，写完回读校验；失败则用 tmp 重写一次
   * 不保证原子性或严格内容一致；恢复只接受可解析的候选。
   */
  async function doSave(data: AppData): Promise<void> {
    const text = JSON.stringify(data);
    await ensureDir('waketime');
    rejectFutureSchema(await readText(DATA_FILE));

    await writeText(TMP_FILE, text);
    if (!parseDataText(await readText(TMP_FILE), now)) {
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
    if (!parseDataText(await readText(DATA_FILE), now)) {
      // 主文件写坏了：立刻用 tmp 再兜一次
      await writeText(DATA_FILE, text);
      if (!parseDataText(await readText(DATA_FILE), now)) {
        throw new Error('主数据文件写入校验失败（可从 data.prev.json 恢复）');
      }
    }
    void writeBackup(text);
  }

  /** 串行写入，避免并发保存互相覆盖 */
  function save(data: AppData): Promise<void> {
    saveChain = saveChain.catch(() => undefined).then(() => doSave(data));
    return saveChain;
  }

  return { load, save };
}
