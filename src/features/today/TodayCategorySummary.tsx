import { useState } from 'react';
import type { CategoryDefinition } from '../../modules/classification/index';
import { completeCategories } from '../../modules/classification/index';
import { categoryColor } from '../../modules/classification/index';
import { summaryRows } from '../../modules/analytics/index';
import type { CycleSummary as Totals } from '../../modules/time-tracking/index';
import { formatHuman } from '../../modules/time-tracking/index';

/**
 * 今日页分类汇总：默认按大类合计（含下属小标签），点某个大类看它的细分；
 * 下钻后点框内任意处返回大类合计，不额外占一行按钮。
 */
export function TodayCategorySummary({
  totals,
  categories,
}: {
  totals: Totals;
  categories: CategoryDefinition[];
}) {
  const [drillId, setDrillId] = useState<string | null>(null);
  const catalog = completeCategories(
    categories,
    Object.keys(totals.categoryMs).map((category) => ({ category })),
  );
  const parent = drillId ? catalog.find((c) => c.id === drillId && !c.archived) : null;
  const activeDrill = parent ? parent.id : null;
  const rows = summaryRows(totals.categoryMs, catalog, activeDrill);
  const back = () => setDrillId(null);

  return (
    <div
      className={`cycle-summary today-summary${parent ? ' is-drilled' : ''}`}
      onClick={parent ? back : undefined}
      onKeyDown={
        parent
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                back();
              }
            }
          : undefined
      }
      role={parent ? 'button' : undefined}
      tabIndex={parent ? 0 : undefined}
      aria-label={parent ? `${parent.name}的细分时间，点任意处返回大类汇总` : '本周期分类汇总'}
    >
      {parent ? <div className="summary-crumb">‹ {parent.name} · 点任意处返回</div> : null}
      {rows.map((row) => {
        const body = (
          <>
            <span>
              <i
                className="category-color-dot"
                style={{ background: categoryColor(row.id, catalog) }}
                aria-hidden="true"
              />
              {row.label}
              {row.drillable ? (
                <em className="summary-chevron" aria-hidden="true">
                  {' '}
                  ›
                </em>
              ) : null}
            </span>
            <strong>{formatHuman(row.ms)}</strong>
          </>
        );
        return row.drillable ? (
          <button
            type="button"
            key={row.id}
            className="summary-row is-drillable"
            aria-label={`查看${row.label}的细分`}
            onClick={() => setDrillId(row.id)}
          >
            {body}
          </button>
        ) : (
          <div key={row.id} className="summary-row">
            {body}
          </div>
        );
      })}
    </div>
  );
}
