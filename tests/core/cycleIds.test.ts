import { describe, expect, it } from 'vitest';
import { uniqueCycleId } from '../../src/modules/time-tracking/index';

describe('周期 ID 去重', () => {
  it('日期不存在时直接使用', () => {
    expect(uniqueCycleId('2026-11-14', [])).toBe('2026-11-14');
    expect(uniqueCycleId('2026-11-14', [{ id: '2026-11-13' }])).toBe('2026-11-14');
  });

  it('同一天已有周期时追加后缀，且跳过已占用后缀', () => {
    const existing = [{ id: '2026-11-14' }, { id: '2026-11-14-2' }, { id: '2026-11-14-4' }];
    expect(uniqueCycleId('2026-11-14', existing)).toBe('2026-11-14-3');
  });
});
