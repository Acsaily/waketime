import type { CategoryDefinition } from '../core/categories';
import { completeCategories } from '../core/categories';
import type { CycleSummary as Totals } from '../core/segments';
import { formatHuman } from '../core/time';

/** 文本汇总，不靠颜色区分类别；零时长自定义项不挤占手机屏幕。 */
export function CycleSummary({ totals, categories, sleep = false, className = '' }: {
  totals: Totals; categories: CategoryDefinition[]; sleep?: boolean; className?: string;
}) {
  const catalog = completeCategories(categories, Object.keys(totals.categoryMs).map((category) => ({ category })));
  return <div className={`cycle-summary ${className}`} aria-label="本周期分类汇总">
    {catalog.filter((c) => c.id !== 'sleep' && (c.id === 'unclassified' || (totals.categoryMs[c.id] ?? 0) > 0)).map((c) => (
      <div key={c.id}><span>{c.name}{c.archived ? '（已停用）' : ''}</span><strong>{formatHuman(totals.categoryMs[c.id] ?? 0)}</strong></div>
    ))}
    {sleep ? <div><span>总睡眠</span><strong>{formatHuman(totals.totalSleepMs)}</strong></div> : null}
  </div>;
}
