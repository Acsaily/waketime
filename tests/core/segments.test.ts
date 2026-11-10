import { describe, expect, it } from 'vitest';
import { categoryOf, editSegment, mergeAdjacentSegments, repairWakeGap, summarizeCycle } from '../../src/core/segments';
import { APP_VERSION, defaultData, parseDataText, sanitizeCycle, type Cycle, type Segment } from '../../src/data/store';
import { buildBackupJson, buildDayTxt } from '../../src/export/format';
import { buildPdfBlocks } from '../../src/export/pdfDoc';
import { buildTrend } from '../../src/core/trends';
const H = 3_600_000, T = Date.UTC(2026, 9, 20, 0);
const seg = (id: string, start: number, end: number | null, category: Segment['category'] = 'unclassified', note = ''): Segment =>
  ({ id, seq: 1, startAtMs: T + start * H, endAtMs: end === null ? 0 : T + end * H, category, note, source: 'app' });
function cycle(segments: Segment[] = []): Cycle {
  return { id: 'c', timeZone: 'Asia/Shanghai', sleepAtMs: T - 3 * H, wakeAtMs: T, sleepDurationMs: 3 * H,
    awakeBudgetMs: 21 * H, targetAtMs: T + 21 * H, sleepMetrics: { score: null, reportedTotalMs: null, note: null },
    screenshotPath: null, source: 'manual', session: { id: 's', status: 'running', startedAtMs: T, segments },
    closedAtMs: null, flags: [], createdAtMs: T, updatedAtMs: T };
}
describe('v0.4.0 wake coverage and safe editing', () => {
  it('adds a separate unclassified wake gap without changing the original note or timestamp', () => {
    const original = seg('a', 0.5, 1, 'work', '原备注'); const repaired = repairWakeGap([original], T, 'c');
    expect(repaired[0]).toMatchObject({ id: 'c:wake-gap', startAtMs: T, endAtMs: T + H / 2, category: 'unclassified' });
    expect(repaired[1]).toMatchObject({ id: 'a', startAtMs: original.startAtMs, endAtMs: original.endAtMs, note: '原备注', category: 'work', seq: 2 }); expect(repairWakeGap(repaired, T, 'c')).toEqual(repaired);
  });
  it('does not guess sleep or work from legacy notes', () => { expect(categoryOf({})).toBe('unclassified'); expect(sanitizeCycle(cycle([seg('a', 0, 1, undefined, '补觉 工作')])).session!.segments[0].category).toBe('unclassified'); });
  it('edits a completed segment as nap without mutating the input', () => { const s = [seg('a', 0, 1)]; expect(editSegment(s, 'a', { note: '补觉', category: 'sleep' })[0].category).toBe('sleep'); expect(s[0].category).toBe('unclassified'); });
  it('blocks open sleep transitions through editing', () => { expect(() => editSegment([seg('a', 0, null)], 'a', {note: '', category: 'sleep'})).toThrow(); expect(() => editSegment([seg('a', 0, null, 'sleep')], 'a', {note: '', category: 'work'})).toThrow(); });
  it('merges duplicate taps while preserving notes, outer boundaries and explicit category', () => {
    const s = [seg('a', 0, 1.5, 'work', '方案'), seg('b', 1.5, 1.501, 'daily', '误点'), seg('c', 1.501, null)];
    const merged = mergeAdjacentSegments(s, 'a', 'b', 'work');
    expect(merged).toHaveLength(2); expect(merged[0]).toMatchObject({ id: 'a', startAtMs: T, endAtMs: T + 1.501 * H, note: '方案\n误点', category: 'work' }); expect(merged[1].seq).toBe(2); expect(s).toHaveLength(3);
  });
  it('retains an open second segment after merging', () => { const merged = mergeAdjacentSegments([seg('a', 0, 1, 'work', '相同'), seg('b', 1, null, 'daily', '相同')], 'a', 'b', 'daily'); expect(merged[0]).toMatchObject({endAtMs: 0, note: '相同', category: 'daily'}); });
  it('rejects nonadjacent or reversed merges and pause gaps', () => { const s = [seg('a', 0, 1),seg('b', 2, 3),seg('c', 3, null)]; expect(() => mergeAdjacentSegments(s,'a','c','work')).toThrow(); expect(() => mergeAdjacentSegments(s,'b','a','work')).toThrow(); expect(() => mergeAdjacentSegments(s,'a','b','work')).toThrow(); });
  it('cannot switch an open segment into or out of nap through merge', () => { expect(() => mergeAdjacentSegments([seg('a',0,1),seg('b',1,null)],'a','b','sleep')).toThrow(); expect(() => mergeAdjacentSegments([seg('a',0,1),seg('b',1,null,'sleep')],'a','b','daily')).toThrow(); });
});
describe('v0.4.0 shared sleep and category totals', () => {
  const c = cycle([seg('a',0,1,'work'),seg('b',1,3,'sleep'),seg('c',3,4,'daily'),seg('d',5,null)]);
  it('totals main sleep plus nap, excludes nap from awake and includes pause gaps as unclassified', () => { expect(summarizeCycle(c,T+6*H)).toEqual({categoryMs: {work:H,daily:H,unclassified:2*H},mainSleepMs:3*H,napMs:2*H,totalSleepMs:5*H,awakeMs:4*H,workMs:H,dailyMs:H,unclassifiedMs:2*H}); expect(c.targetAtMs).toBe(T+21*H); });
  it('freezes actual awake while a nap is open', () => { const n = cycle([seg('a',0,1,'work'),seg('b',1,null,'sleep')]); expect(summarizeCycle(n,T+2*H).awakeMs).toBe(H); expect(summarizeCycle(n,T+3*H).awakeMs).toBe(H); expect(n.targetAtMs).toBe(T+21*H); });
  it('clips open and completed segments to cycle closure and avoids counting overlaps twice', () => { const closed = {...c,closedAtMs:T+3.5*H}; expect(summarizeCycle(closed,T+20*H).dailyMs).toBe(H/2); const overlap=cycle([seg('a',0,2,'work'),seg('b',1,3,'daily')]); expect(summarizeCycle(overlap,T+3*H).workMs+summarizeCycle(overlap,T+3*H).dailyMs).toBe(3*H); });
  it('uses nap-inclusive duration in trends without moving the reference deadline', () => { expect(buildTrend([c],T+6*H)[0]).toMatchObject({sleepDurationMs:5*H,targetAtMs:T+21*H}); });
  it('exports categories and totals consistently in TXT and PDF', () => { const closed={...c,closedAtMs:T+6*H}; expect(buildDayTxt(closed)).toContain('工作 1h'); expect(buildDayTxt(closed)).toContain('[补觉]'); const text=buildPdfBlocks(closed).map(b=>b.text).join('\n'); expect(text).toContain('工作 1h'); expect(text).toContain('总睡眠 5h'); });
  it('round trips legacy and new backups with notes, categories and settings preserved', () => { const data=parseDataText(buildBackupJson([c],defaultData().settings)); expect(data?.cycles[0].session!.segments.map(s=>s.category)).toEqual(c.session!.segments.map(s=>s.category)); expect(data?.settings).toEqual(defaultData().settings); expect(data?.appVersion).toBe(APP_VERSION); expect(JSON.parse(buildBackupJson([c])).cycleSummaries).toHaveLength(1); });
  it('rejects malformed sessions and future schemas instead of silently replacing data', () => { const d = defaultData(); expect(parseDataText(JSON.stringify({ ...d, cycles: [{ ...c, session: { segments: 'bad' } }] }))).toBeNull(); expect(parseDataText(JSON.stringify({ ...d, schemaVersion: 99 }))).toBeNull(); expect(parseDataText(JSON.stringify({ ...d, cycles: [{ ...c, closedAtMs: NaN }] }))).not.toBeNull(); expect(parseDataText(JSON.stringify({ ...d, cycles: [] }))).not.toBeNull(); expect(parseDataText(JSON.stringify({ ...d, cycles: [c, { ...c, id: 'c' }] }))).toBeNull(); });
});
