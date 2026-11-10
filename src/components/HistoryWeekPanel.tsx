import { useEffect, useRef } from 'react';
import type { WeekMetric, WeekStats } from '../core/history';
import {
  formatClockMinutes,
  formatDateShort,
  formatSignedShort,
  formatWeekRange,
  formatWeekday,
  msOfDateKey,
} from '../core/history';
import { formatHuman } from '../core/time';
import { DriftChart, DurationChart, IntervalChart } from './HistoryCharts';

function weekAvgSleep(week: WeekMetric): number | null {
  let total = 0;
  let count = 0;
  for (const day of week.days) {
    if (!day) continue;
    total += day.totalSleepMs;
    count++;
  }
  return count ? total / count : null;
}

export function HistoryWeekPanel({
  weeks,
  active,
  stats,
  previousStats,
  onSelectWeek,
  onShowDays,
}: {
  weeks: WeekMetric[];
  active: WeekMetric;
  stats: WeekStats;
  previousStats: WeekStats | null;
  onSelectWeek: (key: string) => void;
  onShowDays: () => void;
}) {
  const railRef = useRef<HTMLDivElement>(null);
  const touched = useRef(false);
  const timer = useRef<number | null>(null);

  // 选中周居中；只在有用户拖动时才把最近的周反选回去，避免初始定位误选。
  useEffect(() => {
    const rail = railRef.current;
    const current = rail?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!rail || !current) return;
    const left = current.offsetLeft - (rail.clientWidth - current.offsetWidth) / 2;
    rail.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
  }, [active.key]);

  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  const onRailScroll = () => {
    if (!touched.current) return;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const rail = railRef.current;
      if (!rail) return;
      const center = rail.scrollLeft + rail.clientWidth / 2;
      let best = active.key;
      let bestDistance = Infinity;
      rail.querySelectorAll<HTMLElement>('.history-week-chip').forEach((chip) => {
        const chipCenter = chip.offsetLeft + chip.offsetWidth / 2;
        const distance = Math.abs(chipCenter - center);
        if (distance < bestDistance) { bestDistance = distance; best = chip.dataset.week ?? best; }
      });
      onSelectWeek(best);
    }, 140);
  };

  const diff = previousStats ? Math.round(stats.avgSleepMs - previousStats.avgSleepMs) : null;
  const sleepText = `本周平均睡眠 ${formatHuman(stats.avgSleepMs)}`
    + (diff === null ? '' : diff === 0 ? '，与上周持平' : `，比上周${diff > 0 ? '多' : '少'} ${formatHuman(Math.abs(diff))}`);
  const bedText = `入睡在 ${formatClockMinutes(stats.minBedMinutes)}–${formatClockMinutes(stats.maxBedMinutes)} 之间，跨度 ${formatHuman(stats.spreadMinutes * 60_000)}`;
  const driftText = stats.avgAbsDriftMs === null
    ? '相邻两晚记录不足，暂时算不出参考截止偏移。'
    : `相对参考截止，平均每晚偏移 ${formatHuman(stats.avgAbsDriftMs)}`
      + (stats.maxDrift
        ? `，偏移最大的一晚是 ${formatDateShort(msOfDateKey(stats.maxDrift.dateKey))}（${formatSignedShort(stats.maxDrift.driftMs)}）`
        : '') + '。';

  return (
    <div className="history-week-panel">
      <div className="history-rail-head">
        <span>按周查看</span>
        <span className="muted small">左右滑动周条切换</span>
      </div>
      <div
        className="history-week-rail" ref={railRef} data-no-swipe
        onPointerDown={() => { touched.current = true; }}
        onTouchStart={() => { touched.current = true; }}
        onWheel={() => { touched.current = true; }}
        onScroll={onRailScroll}
        aria-label="选择周"
      >
        {weeks.map((week) => {
          const average = weekAvgSleep(week);
          const isActive = week.key === active.key;
          return (
            <button
              key={week.key}
              type="button"
              data-week={week.key}
              className="history-week-chip"
              aria-current={isActive ? 'true' : undefined}
              onClick={() => { touched.current = false; onSelectWeek(week.key); }}
            >
              <b>{formatWeekRange(week)}</b>
              <span>{average === null ? '无记录' : `均睡 ${formatHuman(average)}`}</span>
            </button>
          );
        })}
      </div>

      <section className="history-hero" aria-label="本周睡眠概览">
        <div className="history-hero-top">
          <div>
            <div className="history-hero-kicker">{formatWeekRange(active)} · 平均总睡眠 · {stats.recordedDays} 天记录</div>
            <div className="history-hero-number mono">{formatHuman(stats.avgSleepMs)}</div>
          </div>
          <div className="history-hero-side mono">
            平均入睡<b>{formatClockMinutes(stats.avgBedMinutes)}</b><br />
            平均起床<b>{formatClockMinutes(stats.avgWakeMinutes)}</b>
          </div>
        </div>
        <div className="history-hero-divider" />
        <div className="history-range-head">
          <span>入睡波动</span>
          <span>跨度 <b>{formatHuman(stats.spreadMinutes * 60_000)}</b></span>
        </div>
        <div className="history-range-line">
          <div className="history-range-track" role="img" aria-label={`最早入睡 ${formatClockMinutes(stats.minBedMinutes)}，最晚 ${formatClockMinutes(stats.maxBedMinutes)}`} />
        </div>
        <div className="history-range-labels mono">
          <span>最早 <b>{formatClockMinutes(stats.minBedMinutes)}</b></span>
          <span>最晚 <b>{formatClockMinutes(stats.maxBedMinutes)}</b></span>
        </div>
        <div className="history-metric-pair">
          <div className="history-metric-pill">
            <span>平均每晚偏移</span>
            <b className="mono">{stats.avgAbsDriftMs === null ? '—' : formatHuman(stats.avgAbsDriftMs)}</b>
          </div>
          <div className="history-metric-pill">
            <span>最晚的一晚</span>
            <b className="mono">{formatWeekday(stats.latest.dateMs)} {formatClockMinutes(stats.latest.bedMinutes)}</b>
          </div>
        </div>
      </section>

      <section className="history-chart-card">
        <div className="history-card-head">
          <span className="history-card-title">相对参考截止的偏移</span>
          <span className="muted small">{stats.drifts.length} 晚可比</span>
        </div>
        <DriftChart week={active} />
        <p className="history-chart-note">正数（橙）表示比参考截止晚睡，负数（绿）表示提前。浅色带是本周偏移范围；缺下一晚记录显示「—」，不跨日硬算。</p>
      </section>

      <section className="history-chart-card">
        <div className="history-card-head">
          <span className="history-card-title">每天睡了多久</span>
          <span className="muted small">总睡眠含补觉</span>
        </div>
        <DurationChart week={active} avgSleepMs={stats.avgSleepMs} />
        <p className="history-chart-note">虚线是本周平均 {formatHuman(stats.avgSleepMs)}；灰色短柱表示没有记录。</p>
      </section>

      <section className="history-chart-card">
        <div className="history-card-head">
          <span className="history-card-title">睡眠区间</span>
          <span className="muted small">入睡 → 起床</span>
        </div>
        <IntervalChart week={active} />
        <p className="history-chart-note">同一行左侧是入睡、右侧是起床。条越长睡得越久；整列左右移动，就是入睡时间的波动。</p>
      </section>

      <section className="history-insight">
        <div className="history-card-head">
          <span className="history-card-title">这周的身体时钟</span>
        </div>
        <p>{sleepText}。{bedText}。{driftText}</p>
        <p>入睡和起床越接近每天同一时刻，昼夜节律越稳定。波动大的一周，先看是不是周末后移、或某几晚特别晚。</p>
        <details className="history-research">
          <summary>为什么关注睡眠波动？</summary>
          <p>英国生物样本库约 6 万人、最长随访 7.8 年的队列研究显示：睡眠规律性（SRI）对全因死亡风险的预测强于睡眠总时长；规律性最低的一组，全因死亡风险明显更高。</p>
          <p>综述还发现，入睡时间与睡眠时长的日间波动、社会时差，与肥胖、血糖调节变差、代谢综合征和心血管风险相关。以上是观察性证据，相关不等于因果，但规律作息通常被认为是低成本的改善方向。</p>
          <p className="history-citations">
            <a href="https://doi.org/10.1093/sleep/zsad253" target="_blank" rel="noreferrer">Windred 等，SLEEP 2024</a>
            {' · '}
            <a href="https://pubmed.ncbi.nlm.nih.gov/32700156/" target="_blank" rel="noreferrer">Zuraikat 等，Curr Diab Rep 2020</a>
            {' · '}
            <a href="https://pubmed.ncbi.nlm.nih.gov/36873401/" target="_blank" rel="noreferrer">Zhang &amp; Qin，Front Cardiovasc Med 2023</a>
          </p>
        </details>
      </section>

      <button type="button" className="btn ghost block history-show-days" onClick={onShowDays}>
        查看每日明细
      </button>
    </div>
  );
}
