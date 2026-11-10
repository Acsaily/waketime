import { describe, expect, it } from 'vitest';
import { parseDataText, pickRecoveredData, rejectFutureSchema } from '../../src/data/store';

const goodPayload = (id: string) =>
  JSON.stringify({
    schemaVersion: 1,
    appVersion: '0.3.1',
    settings: { notificationsEnabled: true, quickNotes: ['工作'] },
    cycles: [
      {
        id,
        timeZone: 'Asia/Shanghai',
        sleepAtMs: 1_792_942_200_000,
        wakeAtMs: 1_792_969_200_000,
        sleepDurationMs: 27_000_000,
        awakeBudgetMs: 59_400_000,
        targetAtMs: 1_793_028_600_000,
        sleepMetrics: { score: null, reportedTotalMs: null, note: null },
        screenshotPath: null,
        source: 'manual',
        session: { id: 's1', status: 'ended', startedAtMs: 1_792_969_200_000, segments: [] },
        closedAtMs: null,
        flags: [],
        createdAtMs: 1_792_969_200_000,
        updatedAtMs: 1_792_969_200_000,
      },
    ],
  });

describe('parseDataText（恢复候选校验）', () => {
  it('未来版本主文件不可回退旧备份后覆盖；坏 JSON 仍允许常规恢复', () => {
    expect(() => rejectFutureSchema('{"schemaVersion":99,"cycles":[]}')).toThrow('更新版本');
    expect(() => rejectFutureSchema('{"schemaVersion":1,"cycles":[]}')).not.toThrow();
    expect(() => rejectFutureSchema('{broken')).not.toThrow();
  });
  it('空文本 / 空 JSON / 半截 JSON 都判为不可用（真机故障现场）', () => {
    expect(parseDataText('')).toBeNull();
    expect(parseDataText('   ')).toBeNull();
    expect(parseDataText(null)).toBeNull();
    expect(parseDataText('{"schemaVersion":1,"cycles":[')).toBeNull();
  });

  it('schema 版本不对 / cycles 不是数组 → 不可用', () => {
    expect(parseDataText('{"schemaVersion":99,"cycles":[]}')).toBeNull();
    expect(parseDataText('{"schemaVersion":1,"cycles":{}}')).toBeNull();
  });

  it('合法数据可用，且读盘时顺手自愈', () => {
    const parsed = parseDataText(goodPayload('2026-10-26'));
    expect(parsed?.cycles).toHaveLength(1);
  });
});

describe('pickRecoveredData（主文件坏了按优先级恢复）', () => {
  it('主文件是空串，从 data.prev.json 恢复', () => {
    const picked = pickRecoveredData([
      { name: 'data.prev.json', text: goodPayload('2026-10-25') },
      { name: 'data.tmp.json', text: '' },
    ]);
    expect(picked?.name).toBe('data.prev.json');
    expect(picked?.data.cycles[0].id).toBe('2026-10-25');
  });

  it('prev 也坏了，用 tmp', () => {
    const picked = pickRecoveredData([
      { name: 'data.prev.json', text: '{"schema' },
      { name: 'data.tmp.json', text: goodPayload('2026-10-24') },
    ]);
    expect(picked?.name).toBe('data.tmp.json');
  });

  it('前两份都没有内容，用最近的每日备份', () => {
    const picked = pickRecoveredData([
      { name: 'data.prev.json', text: null },
      { name: 'data.tmp.json', text: '' },
      { name: 'backups/data-20261026.json', text: goodPayload('2026-10-26') },
      { name: 'backups/data-20261025.json', text: goodPayload('2026-10-25') },
    ]);
    expect(picked?.name).toBe('backups/data-20261026.json');
  });

  it('空数据（0 天）不作为恢复来源，避免用空文件覆盖', () => {
    const empty = JSON.stringify({ schemaVersion: 1, cycles: [], settings: {} });
    const picked = pickRecoveredData([{ name: 'data.prev.json', text: empty }]);
    expect(picked).toBeNull();
  });
});
