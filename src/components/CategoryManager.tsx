import { useRef, useState } from 'react';
import type { AppApi } from '../state/useApp';
import { isSystemCategory } from '../core/categories';

export function CategoryManager({ api }: { api: AppApi }) {
  const catalog = api.data.settings.categories;
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const locked = useRef(false);
  const active = catalog.filter((c) => !c.archived && !isSystemCategory(c.id));
  const perform = async (action: Parameters<AppApi['manageCategory']>[0], text: string) => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setMessage(null);
    try {
      await api.manageCategory(action);
      setMessage({ text, error: false }); setEditing(null);
      if (action.kind === 'add') setName('');
    } catch (e) { setMessage({ text: e instanceof Error ? e.message : String(e), error: true }); }
    finally { locked.current = false; setBusy(false); }
  };
  return <section className="section category-manager" aria-busy={busy}>
    <div className="section-head"><span>分类管理</span><span className="small muted">每段一个分类</span></div>
    <p className="hint">把时间分给你自己的类别。改名同步历史显示；删除已使用类别只会停用，历史不会丢失。</p>
    <div className="inline-add">
      <input aria-label="新分类名称" placeholder="例如：学习、运动" value={name} maxLength={24} disabled={busy} onChange={(e) => setName(e.target.value)} />
      <button className="btn" disabled={busy || !name.trim()} onClick={() => void perform({ kind: 'add', id: `cat-${crypto.randomUUID()}`, name }, '分类已添加')}>添加</button>
    </div>
    <div className="category-management-list">
      {catalog.filter((c) => !isSystemCategory(c.id) && !c.archived).map((c) => <div className="category-management-row" key={c.id}>
        {editing === c.id ? <div className="category-rename">
          <label className="field"><span>改名会同步历史显示</span><input aria-label={`修改${c.name}名称`} value={editName} disabled={busy} maxLength={24} onChange={(e) => setEditName(e.target.value)} /></label>
          <div className="sheet-actions"><button className="btn ghost" disabled={busy} onClick={() => setEditing(null)}>取消</button><button className="btn" disabled={busy || !editName.trim()} onClick={() => void perform({ kind: 'rename', id: c.id, name: editName }, '分类已改名，历史显示已同步')}>保存名称</button></div>
        </div> : <>
          <strong className="category-name">{c.name}</strong>
          <div className="category-row-actions">
            <button className="chip" aria-label={`上移${c.name}`} disabled={busy || active[0]?.id === c.id} onClick={() => void perform({ kind: 'up', id: c.id }, '顺序已保存')}>上移</button>
            <button className="chip" aria-label={`下移${c.name}`} disabled={busy || active.at(-1)?.id === c.id} onClick={() => void perform({ kind: 'down', id: c.id }, '顺序已保存')}>下移</button>
            <button className="chip" disabled={busy} onClick={() => { setEditing(c.id); setEditName(c.name); setMessage(null); }}>改名</button>
            <button className="chip" disabled={busy} onClick={() => {
              if (window.confirm(`删除“${c.name}”？若有历史记录使用，将仅从新记录选项中移除，历史名称、备注和时长保留；可在已停用分类中恢复。`)) void perform({ kind: 'delete', id: c.id }, '已从新记录选项中移除，历史引用仍保留');
            }}>删除</button>
          </div>
        </>}
      </div>)}
    </div>
    <p className="tiny">未分类用于兜底，补觉用于睡眠计算，两个系统类别始终保留。分类与常用备注相互独立。</p>
    {catalog.some((c) => c.archived) ? <details className="archived-categories"><summary>已停用分类（历史仍保留）</summary>
      {catalog.filter((c) => c.archived).map((c) => <div className="category-management-row" key={c.id}>
        <span className="category-name">{c.name}</span><div className="category-row-actions">
          <button className="chip" disabled={busy} onClick={() => { const next = window.prompt('修改分类名称（同步历史显示）', c.name); if (next !== null) void perform({ kind: 'rename', id: c.id, name: next }, '分类名称已保存'); }}>改名</button>
          <button className="chip" disabled={busy} onClick={() => void perform({ kind: 'restore', id: c.id }, '分类已恢复，可用于新记录')}>恢复使用</button>
        </div>
      </div>)}
    </details> : null}
    {message ? <p className={message.error ? 'error' : 'status'} role={message.error ? 'alert' : 'status'}>{message.text}</p> : null}
  </section>;
}
