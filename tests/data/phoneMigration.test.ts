import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseDataText, defaultData, type AppData } from '../../src/application/index';
import {
  readRestoreBackup,
  buildRestoredData,
  categoryConflicts,
} from '../../src/application/index';
import { buildBackupJson } from '../../src/application/index';
import { N, golden, schemas } from '../fixtures/synthetic';

// Keep the original phone migration assertions, using synthetic schema 1/2/3
// by default. Private opt-in uses boolean comparisons to avoid diffing personal values.
function verifyMigration(text: string): void {
  const raw = JSON.parse(text) as AppData;
  const migrated = parseDataText(text);
  expect(migrated !== null, 'migration accepted').toBe(true);
  if (!migrated) return;
  expect(migrated.schemaVersion, 'schema').toBe(3);
  expect(migrated.cycles.length, 'cycle count').toBe(raw.cycles.length);
  for (const c of raw.cycles) {
    const next = migrated.cycles.find((n) => n.id === c.id);
    expect(next !== undefined, 'cycle identity retained').toBe(true);
    expect(next?.sleepAtMs === c.sleepAtMs, 'sleep boundary retained').toBe(true);
    expect(next?.wakeAtMs === c.wakeAtMs, 'wake boundary retained').toBe(true);
    for (const s of c.session?.segments ?? []) {
      const after = next?.session?.segments.find((n) => n.id === s.id);
      expect(after !== undefined, 'segment identity retained').toBe(true);
      for (const key of ['id', 'startAtMs', 'endAtMs', 'note', 'source', 'splitFromId'] as const) {
        expect(isDeepStrictEqual(after?.[key], s[key]), `segment ${key} retained`).toBe(true);
      }
      expect(after?.category === (s.category ?? 'unclassified'), 'category retained').toBe(true);
    }
  }
  const backup = readRestoreBackup(JSON.parse(buildBackupJson(migrated.cycles, migrated.settings)));
  const local = defaultData();
  const resolutions = Object.fromEntries(
    categoryConflicts(local.settings.categories, backup.categories).map((c) => [
      c.id,
      'backup' as const,
    ]),
  );
  const restored = buildRestoredData(local, backup, 'overwrite', resolutions);
  expect(
    isDeepStrictEqual(
      restored.cycles,
      [...migrated.cycles].sort((a, b) => b.wakeAtMs - a.wakeAtMs),
    ),
    'restored cycles',
  ).toBe(true);
  expect(
    isDeepStrictEqual(restored.settings.categories, migrated.settings.categories),
    'restored catalog',
  ).toBe(true);
}

afterEach(() => vi.useRealTimers());
describe('合成备份的隔离迁移与恢复', () => {
  it.each(schemas.map((schema, i) => ({ schema, version: i + 1 })))(
    'schema $version 原 ID、边界、备注、类别、来源、谱系不丢失',
    ({ schema }) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(N);
      verifyMigration(JSON.stringify(schema));
    },
  );
  it('schema 3 规范记录逐字段保留', () => {
    const data = golden();
    expect(parseDataText(JSON.stringify(data))).toEqual(data);
  });
});

const path = process.env.WAKETIME_PHONE_BACKUP;
describe.skipIf(!path)('显式指定的本地私人备份（不回写）', () => {
  it('逐记录迁移及恢复', () => {
    if (!path || !isAbsolute(path))
      throw new Error('WAKETIME_PHONE_BACKUP must be an absolute local path');
    const now = Number(process.env.WAKETIME_AS_OF_MS);
    if (!Number.isSafeInteger(now) || now <= 0)
      throw new Error('WAKETIME_AS_OF_MS must be an explicit epoch');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    // Do not include input values, paths or underlying parser errors in test output.
    try {
      const text = readFileSync(path, 'utf8');
      verifyMigration(text);
      expect(readFileSync(path, 'utf8') === text, 'original unchanged').toBe(true);
    } catch {
      throw new Error(
        'Private backup migration/read-only/restore check failed; use the aggregate-only differential runner for diagnosis',
      );
    }
  });
});
