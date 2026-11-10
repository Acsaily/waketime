import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDataText } from '../../src/data/store';
import { readRestoreBackup, buildRestoredData } from '../../src/data/restore';
import { buildBackupJson } from '../../src/export/format';
import { defaultData } from '../../src/data/store';

const path = resolve('docs/backup-from-phone/pre-v050-20261106/data-before-v050.json');
describe.skipIf(!existsSync(path))('本次真机备份的隔离迁移与恢复（不回写手机）', () => {
  it('逐段保留所有原 ID、毫秒边界、备注、类别与来源', () => {
    const text = readFileSync(path, 'utf8'); const raw = JSON.parse(text);
    const migrated = parseDataText(text)!;
    expect(migrated.schemaVersion).toBe(2); expect(migrated.cycles.length).toBe(raw.cycles.length);
    for (const c of raw.cycles) {
      const next = migrated.cycles.find((n) => n.id === c.id)!;
      expect(next.sleepAtMs).toBe(c.sleepAtMs); expect(next.wakeAtMs).toBe(c.wakeAtMs);
      for (const s of c.session?.segments ?? []) {
        const after = next.session!.segments.find((n) => n.id === s.id)!;
        expect(after).toMatchObject({ id: s.id, startAtMs: s.startAtMs, endAtMs: s.endAtMs,
          note: s.note, category: s.category ?? 'unclassified', source: s.source });
      }
    }
    const restored = buildRestoredData(defaultData(), readRestoreBackup(JSON.parse(buildBackupJson(migrated.cycles, migrated.settings))), 'overwrite');
    expect(restored.cycles).toEqual(migrated.cycles); expect(restored.settings.categories).toEqual(migrated.settings.categories);
    expect(readFileSync(path, 'utf8')).toBe(text);
  });
});
