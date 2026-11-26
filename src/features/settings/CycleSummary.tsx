import type { CategoryDefinition } from '../../modules/classification/index';
import { categoryPath, completeCategories } from '../../modules/classification/index';
import { categoryColor } from '../../modules/classification/index';
import type { CycleSummary as Totals } from '../../modules/time-tracking/index';
import { formatHuman } from '../../modules/time-tracking/index';

/** 文本汇总，不靠颜色区分类别；零时长自定义项不挤占手机屏幕。 */
export function CycleSummary({
  totals,
  categories,
  sleep = false,
  className = '',
}: {
  totals: Totals;
  categories: CategoryDefinition[];
  sleep?: boolean;
  className?: string;
}) {
  const catalog = completeCategories(
    categories,
    Object.keys(totals.categoryMs).map((category) => ({ category })),
  );
  return (
    <div className={`cycle-summary ${className}`} aria-label="本周期分类汇总">
      {catalog
        .filter(
          (c) =>
            c.id !== 'sleep' && (c.id === 'unclassified' || (totals.categoryMs[c.id] ?? 0) > 0),
        )
        .map((c) => (
          <div key={c.id}>
            <span>
              <i
                className="category-color-dot"
                style={{ background: categoryColor(c.id, catalog) }}
                aria-hidden="true"
              />
              {categoryPath(c.id, catalog)}
              {c.archived ? '（已停用）' : ''}
            </span>
            <strong>{formatHuman(totals.categoryMs[c.id] ?? 0)}</strong>
          </div>
        ))}
      {sleep ? (
        <div>
          <span>总睡眠</span>
          <strong>{formatHuman(totals.totalSleepMs)}</strong>
        </div>
      ) : null}
    </div>
  );
}
