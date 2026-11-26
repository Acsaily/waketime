import { describe, expect, it } from 'vitest';
import { createRecordStore, createBrowserRecordStore } from '../../src/infrastructure/recordStore';
import { readRestoreBackup } from '../../src/application/index';
import { H, T } from '../fixtures';

const legacy = JSON.stringify({
  schemaVersion: 1,
  cycles: [{ id: 'legacy', sleepAtMs: T - 8 * H, wakeAtMs: T }],
});
const now = T + H;
describe('schema normalization with injected time', () => {
  it('legacy timestamps absent from JSON use store clock rather than ambient wall clock', async () => {
    const store = createRecordStore(
      {
        async read() {
          return legacy;
        },
        async write() {},
        async mkdir() {},
        async list() {
          return [];
        },
        async remove() {},
      },
      () => now,
    );
    expect((await store.load()).data.cycles[0]).toMatchObject({
      createdAtMs: now,
      updatedAtMs: now,
    });
    const browser = createBrowserRecordStore({ getItem: () => legacy, setItem() {} }, () => now);
    expect((await browser.load()).data.cycles[0]).toMatchObject({
      createdAtMs: now,
      updatedAtMs: now,
    });
  });
  it('restore parsing can use the same clock without changing explicit legacy timestamps', () => {
    const raw = {
      schemaVersion: 1,
      cycles: [{ id: 'legacy', sleepAtMs: T - 8 * H, wakeAtMs: T, createdAtMs: T }],
    };
    expect(readRestoreBackup(raw, () => now).cycles[0]).toMatchObject({
      createdAtMs: T,
      updatedAtMs: now,
    });
  });
});
