import type { Segment } from '../data/store';
import { categoryLabel, categoryOf } from '../core/segments';
import { formatClock, formatHuman } from '../core/time';
import { defaultCategories, type CategoryDefinition } from '../core/categories';

export function Timeline({
  segments,
  now,
  onEdit,
  disabled = false,
  categories = defaultCategories(),
  emptyHint = '还没有计次记录，点上面的「计次」开始记录',
}: {
  segments: Segment[];
  now: number;
  onEdit?: (segment: Segment) => void;
  disabled?: boolean;
  categories?: CategoryDefinition[];
  emptyHint?: string;
}) {
  if (segments.length === 0) return <p className="hint">{emptyHint}</p>;
  return (
    <div className="timeline">
      {segments.map((s) => {
        const running = s.endAtMs === 0;
        const end = running ? now : s.endAtMs;
        const duration = Math.max(0, end - s.startAtMs);
        const crossDay = new Date(s.startAtMs).toDateString() !== new Date(end).toDateString();
        const category = categoryOf(s);
        const content = <>
          <div className="timeline-time">
            {formatClock(s.startAtMs)} – {running ? '现在' : formatClock(s.endAtMs)}
            {crossDay ? <span className="tag">跨日</span> : null}
          </div>
          <div className="timeline-note">
            <span className={`segment-category category-${category}`}>{categoryLabel(category, categories)}</span>
            <span className="segment-note">{s.note || <span className="muted">{running ? category === 'sleep' ? '补觉中…' : '进行中…' : '没有备注'}</span>}</span>
            {onEdit ? <span className="timeline-edit-hint">编辑 / 拆分 / 合并</span> : null}
          </div>
          <div className="timeline-duration">{duration < 60_000 ? '<1m' : formatHuman(duration)}</div>
        </>;
        return onEdit ? (
          <button key={s.id} className={`timeline-row ${running ? 'running' : ''}`} disabled={disabled} onClick={() => onEdit(s)} aria-label={`编辑第 ${s.seq} 段，${categoryLabel(category, categories)}，${formatClock(s.startAtMs)} 开始`}>
            {content}
          </button>
        ) : <div key={s.id} className={`timeline-row ${running ? 'running' : ''}`}>{content}</div>;
      })}
    </div>
  );
}
