import { describe, expect, it } from 'vitest';
import {
  createRecordStore,
  createBrowserRecordStore,
  type RecordFileSystem,
} from '../../src/infrastructure/recordStore';
import { DataCorruptError, defaultData } from '../../src/application/index';
import { cycle, H, T } from '../fixtures';

const primary = 'waketime/data.json';
const previous = 'waketime/data.prev.json';
const temporary = 'waketime/data.tmp.json';
const backupDir = 'waketime/backups';
const a = { ...defaultData(), cycles: [cycle([], 'a')] };
const b = { ...defaultData(), cycles: [cycle([], 'b')] };
const textA = JSON.stringify(a),
  textB = JSON.stringify(b);
const broken = '{"cycles":';
const future = JSON.stringify({ ...a, schemaVersion: 4 });

function disk(seed: Record<string, string> = {}) {
  const values = new Map(Object.entries(seed));
  const calls: string[] = [];
  let onWrite: ((path: string, content: string) => Promise<string>) | undefined;
  let onRead: ((path: string, content: string | null) => Promise<string | null>) | undefined;
  let time = T + H;
  // No filesystem or platform dependencies: simulate the byte-level effects of truncation and permission errors.
  const fs: RecordFileSystem = {
    async read(path) {
      calls.push(`read:${path}`);
      const value = values.get(path) ?? null;
      return onRead ? onRead(path, value) : value;
    },
    async write(path, content) {
      calls.push(`write:${path}`);
      values.set(path, onWrite ? await onWrite(path, content) : content);
    },
    async mkdir(path) {
      calls.push(`mkdir:${path}`);
    },
    async list(path) {
      calls.push(`list:${path}`);
      return [...values.keys()]
        .filter((k) => k.startsWith(`${path}/`))
        .map((k) => k.slice(path.length + 1));
    },
    async remove(path) {
      calls.push(`delete:${path}`);
      values.delete(path);
    },
  };
  const open = () => createRecordStore(fs, () => time);
  return {
    values,
    calls,
    open,
    onWrite: (fn: typeof onWrite) => {
      onWrite = fn;
    },
    onRead: (fn: typeof onRead) => {
      onRead = fn;
    },
    setTime: (ms: number) => {
      time = ms;
    },
  };
}

async function settleBackups() {
  for (let i = 0; i < 60; i++) await Promise.resolve();
}
const ids = (text: string | undefined) => JSON.parse(text!).cycles.map((c: { id: string }) => c.id);

describe('native safe-write policy on injected files', () => {
  it('defaults only on missing main and keeps a legal empty main over nonempty backup', async () => {
    expect((await disk().open().load()).data.cycles).toEqual([]);
    const d = disk({ [primary]: JSON.stringify(defaultData()), [previous]: textA });
    expect(await d.open().load()).toMatchObject({ data: { cycles: [] }, recoveredFrom: null });
  });

  it('chooses prev before tmp before backups, skipping broken/unreadable/empty candidates without writes', async () => {
    const d = disk({
      [primary]: broken,
      [previous]: textA,
      [temporary]: textB,
      [`${backupDir}/data-2.json`]: textA,
      [`${backupDir}/data-1.json`]: textB,
    });
    expect(await d.open().load()).toMatchObject({
      recoveredFrom: 'data.prev.json',
      data: { cycles: [{ id: 'a' }] },
    });
    d.values.set(previous, JSON.stringify(defaultData()));
    expect(await d.open().load()).toMatchObject({
      recoveredFrom: 'data.tmp.json',
      data: { cycles: [{ id: 'b' }] },
    });
    d.values.set(temporary, broken);
    d.onRead(async (path, value) => {
      if (path.endsWith('data-2.json')) throw new Error('permission');
      return value;
    });
    expect(await d.open().load()).toMatchObject({
      recoveredFrom: 'backups/data-1.json',
      data: { cycles: [{ id: 'b' }] },
    });
    expect(d.calls.filter((c) => c.startsWith('write:'))).toEqual([]);
  });

  it('rejects bad main without recovery, permission errors, and future main even if prev is usable', async () => {
    await expect(
      disk({ [primary]: broken })
        .open()
        .load(),
    ).rejects.toBeInstanceOf(DataCorruptError);
    const d = disk({ [primary]: textA, [previous]: textB });
    d.onRead(async (path, contents) => {
      if (path === primary) throw new Error('Permission denied');
      return contents;
    });
    await expect(d.open().load()).rejects.toThrow('无法读取');
    d.onRead(undefined);
    d.values.set(primary, future);
    const store = d.open();
    await expect(store.load()).rejects.toThrow('更新版本');
    await expect(store.save(b)).rejects.toThrow('更新版本');
    expect(d.values.get(primary)).toBe(future);
    expect(d.calls.filter((c) => c.startsWith('write:'))).toEqual([]);
  });

  it.each(['throw', 'truncate'])('tmp %s leaves old main untouched', async (kind) => {
    const d = disk({ [primary]: textA });
    d.onWrite(async (path, text) => {
      if (path !== temporary) return text;
      if (kind === 'throw') throw new Error('disk');
      return broken;
    });
    await expect(d.open().save(b)).rejects.toThrow();
    expect(d.values.get(primary)).toBe(textA);
    expect(d.calls).not.toContain(`write:${primary}`);
    expect((await d.open().load()).data.cycles[0].id).toBe('a');
  });

  it('prev copy failure is best effort; main succeeds and new instance loads B', async () => {
    const d = disk({ [primary]: textA });
    d.onWrite(async (path, text) => {
      if (path === previous) throw new Error('copy');
      return text;
    });
    await d.open().save(b);
    await settleBackups();
    expect(d.values.get(temporary)).toBe(textB);
    expect((await d.open().load()).data.cycles[0].id).toBe('b');
  });

  it.each([true, false])('readback corruption retries once; success=%s', async (success) => {
    const d = disk({ [primary]: textA });
    let writes = 0;
    d.onWrite(async (path, text) =>
      path === primary && (++writes === 1 || !success) ? broken : text,
    );
    const pending = d.open().save(b);
    if (success) await pending;
    else await expect(pending).rejects.toThrow('主数据文件写入校验失败');
    await settleBackups();
    expect(writes).toBe(2);
    expect(d.values.get(previous)).toBe(textA);
    expect(d.values.get(temporary)).toBe(textB);
    expect(await d.open().load()).toMatchObject({
      recoveredFrom: success ? null : 'data.prev.json',
      data: { cycles: [{ id: success ? 'b' : 'a' }] },
    });
  });

  it('direct primary throw does not retry and a restart recovers from actual surviving contents', async () => {
    const d = disk({ [primary]: textA });
    d.onWrite(async (path, text) => {
      if (path === primary) {
        d.values.set(primary, broken);
        throw new Error('IO interrupted');
      }
      return text;
    });
    await expect(d.open().save(b)).rejects.toThrow('IO interrupted');
    expect(d.calls.filter((c) => c === `write:${primary}`)).toHaveLength(1);
    expect(await d.open().load()).toMatchObject({
      recoveredFrom: 'data.prev.json',
      data: { cycles: [{ id: 'a' }] },
    });
  });

  it.each([true, false])(
    'two direct save callers run in order even if first fails=%s',
    async (fail) => {
      const d = disk();
      const store = d.open();
      let release!: () => void;
      let entered!: () => void;
      const gate = new Promise<void>((yes) => {
        release = yes;
      });
      const started = new Promise<void>((yes) => {
        entered = yes;
      });
      let first = true;
      d.onWrite(async (path, text) => {
        if (path === temporary && first) {
          first = false;
          entered();
          await gate;
          if (fail) throw new Error('disk');
        }
        return text;
      });
      const p = store.save(a);
      const rejected = p.catch((e) => e);
      await started;
      const n = d.calls.length;
      const q = store.save(b);
      await Promise.resolve();
      await Promise.resolve();
      expect(d.calls).toHaveLength(n);
      release();
      if (fail) expect(await rejected).toEqual(new Error('disk'));
      else await p;
      await q;
      await settleBackups();
      expect(ids(d.values.get(primary))).toEqual(['b']);
    },
  );

  it('backup failures are best effort, same second overwrites, and twenty backups are retained', async () => {
    const d = disk();
    const store = d.open();
    d.onWrite(async (path, text) => {
      if (path.startsWith(`${backupDir}/`)) throw new Error('backup failure');
      return text;
    });
    await store.save(a);
    await settleBackups();
    expect(ids(d.values.get(primary))).toEqual(['a']);
    d.onWrite(undefined);
    for (let i = 0; i < 21; i++) {
      d.setTime(T + H + 1000 * i);
      await store.save(a);
      await settleBackups();
    }
    await store.save(b);
    await settleBackups();
    const backups = [...d.values.entries()]
      .filter(([k]) => k.startsWith(`${backupDir}/`))
      .sort(([a], [b]) => a.localeCompare(b));
    expect(backups).toHaveLength(20);
    expect(ids(backups.at(-1)![1])).toEqual(['b']);
  });

  it('known baseline limitation: legal stale readback is accepted, not guaranteed byte-equal', async () => {
    const d = disk({ [primary]: textA });
    d.onWrite(async (path, content) => (path === primary ? textA : content));
    await d.open().save(b);
    await settleBackups();
    expect(ids(d.values.get(primary))).toEqual(['a']);
    expect(ids(d.values.get(temporary))).toEqual(['b']);
  });
});

describe('browser single-value store', () => {
  it('rejects future version on read and write, and returns an error on corrupt storage', async () => {
    let text: string | null = null;
    const store = createBrowserRecordStore({
      getItem: () => text,
      setItem: (_, value) => {
        text = value;
      },
    });
    expect((await store.load()).data.cycles).toEqual([]);
    await store.save(a);
    expect((await store.load()).data.cycles[0].id).toBe('a');
    text = future;
    await expect(store.load()).rejects.toThrow('更新版本');
    await expect(store.save(b)).rejects.toThrow('更新版本');
    expect(text).toBe(future);
    text = broken;
    await expect(store.load()).rejects.toBeInstanceOf(DataCorruptError);
  });
});
