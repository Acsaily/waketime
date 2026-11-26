import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultData } from '../../src/application/index';
import { cycle } from '../fixtures';

const fake = vi.hoisted(() => ({
  native: true,
  files: new Map<string, string>(),
  calls: [] as string[],
  plugins: [] as string[],
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => fake.native,
    convertFileSrc: (uri: string) => `converted:${uri}`,
  },
  registerPlugin: (name: string) => {
    fake.plugins.push(name);
    return {};
  },
}));
vi.mock('@capacitor/filesystem', () => ({
  Directory: { Data: 'DATA', Cache: 'CACHE' },
  Encoding: { UTF8: 'utf8' },
  Filesystem: {
    async readFile({
      path,
      directory,
      encoding,
    }: {
      path: string;
      directory: string;
      encoding: string;
    }) {
      if (directory !== 'DATA' || encoding !== 'utf8') throw new Error('wrong read target');
      fake.calls.push(`read:${path}`);
      const data = fake.files.get(path);
      if (data === undefined) throw new Error('file not found');
      return { data };
    },
    async writeFile({
      path,
      directory,
      data,
      encoding,
    }: {
      path: string;
      directory: string;
      data: string;
      encoding: string;
    }) {
      if (directory !== 'DATA' || encoding !== 'utf8') throw new Error('wrong write target');
      fake.calls.push(`write:${path}`);
      fake.files.set(path, data);
      return { uri: `uri:${path}` };
    },
    async mkdir({ directory }: { directory: string }) {
      if (directory !== 'DATA') throw new Error('wrong mkdir target');
    },
    async readdir({ path, directory }: { path: string; directory: string }) {
      if (directory !== 'DATA') throw new Error('wrong list target');
      return {
        files: [...fake.files.keys()]
          .filter((key) => key.startsWith(`${path}/`))
          .map((key) => ({ name: key.slice(path.length + 1) })),
      };
    },
    async deleteFile({ path, directory }: { path: string; directory: string }) {
      if (directory !== 'DATA') throw new Error('wrong delete target');
      fake.files.delete(path);
    },
  },
}));

beforeEach(() => {
  fake.files.clear();
  fake.calls.length = 0;
  fake.native = true;
});

describe('real Capacitor record adapter with simulated plugin filesystem', () => {
  it('uses original DATA paths and UTF8, including recovery and serialized saves', async () => {
    const { createPlatformRecordStore } = await import('../../src/infrastructure/platformStore');
    const a = { ...defaultData(), cycles: [cycle([], 'a')] };
    const b = { ...defaultData(), cycles: [cycle([], 'b')] };
    fake.files.set('waketime/data.json', '{');
    fake.files.set('waketime/data.prev.json', JSON.stringify(a));
    const store = createPlatformRecordStore();
    expect(await store.load()).toMatchObject({
      recoveredFrom: 'data.prev.json',
      data: { cycles: [{ id: 'a' }] },
    });
    expect(fake.calls.filter((c) => c.startsWith('write:'))).toEqual([]);
    await Promise.all([store.save(a), store.save(b)]);
    expect(JSON.parse(fake.files.get('waketime/data.json')!).cycles[0].id).toBe('b');
    expect(JSON.parse(fake.files.get('waketime/data.prev.json')!).cycles[0].id).toBe('a');
    expect(JSON.parse(fake.files.get('waketime/data.tmp.json')!).cycles[0].id).toBe('b');
    expect((await createPlatformRecordStore().load()).data.cycles[0].id).toBe('b');
    for (let i = 0; i < 60; i++) await Promise.resolve();
  });
});
