import { useMemo, useRef, useState } from 'react';
import type { AppApi } from '../../application/index';
import {
  CATEGORY_PALETTE,
  isSystemCategory,
  PRE_SLEEP_CATEGORY,
  type CategoryDefinition,
} from '../../modules/classification/index';
import { categoryColor } from '../../modules/classification/index';

export function CategoryManager({ api }: { api: AppApi }) {
  const catalog = api.data.settings.categories;
  const [name, setName] = useState('');
  const [parentForNew, setParentForNew] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [colorTarget, setColorTarget] = useState<string | null>(null);
  const [move, setMove] = useState<{ id: string; parentId: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const locked = useRef(false);
  const nameInput = useRef<HTMLInputElement>(null);

  const topUsers = useMemo(
    () => catalog.filter((c) => !isSystemCategory(c.id) && !c.archived && !c.parentId),
    [catalog],
  );
  const activeChildren = (parentId: string) =>
    catalog.filter((c) => c.parentId === parentId && !isSystemCategory(c.id) && !c.archived);
  const preSleep = catalog.find((c) => c.id === PRE_SLEEP_CATEGORY);
  const archived = catalog.filter((c) => c.archived);

  const perform = async (action: Parameters<AppApi['manageCategory']>[0], text: string) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setMessage(null);
    try {
      await api.manageCategory(action);
      setMessage({ text, error: false });
      setEditing(null);
      setMove(null);
      setColorTarget(null);
      if (action.kind === 'add') {
        setName('');
        setParentForNew('');
      }
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : String(e), error: true });
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };

  const isFirstSibling = (c: CategoryDefinition) => {
    const siblings = catalog.filter(
      (x) =>
        !x.archived && !isSystemCategory(x.id) && (x.parentId ?? null) === (c.parentId ?? null),
    );
    return siblings[0]?.id === c.id;
  };
  const isLastSibling = (c: CategoryDefinition) => {
    const siblings = catalog.filter(
      (x) =>
        !x.archived && !isSystemCategory(x.id) && (x.parentId ?? null) === (c.parentId ?? null),
    );
    return siblings.at(-1)?.id === c.id;
  };

  const colorDot = (c: CategoryDefinition) => {
    const swatch = (
      <span
        className="category-color-dot"
        style={{ background: categoryColor(c.id, catalog) }}
        aria-hidden="true"
      />
    );
    if (isSystemCategory(c.id))
      return (
        <span className="category-color-static" title="系统标签颜色固定">
          {swatch}
        </span>
      );
    return (
      <button
        type="button"
        className="category-color-btn"
        aria-label={`修改${c.name}颜色`}
        aria-expanded={colorTarget === c.id}
        disabled={busy}
        onClick={() => setColorTarget((current) => (current === c.id ? null : c.id))}
      >
        {swatch}
      </button>
    );
  };

  const colorPalette = (c: CategoryDefinition) =>
    colorTarget === c.id ? (
      <div className="category-color-palette" role="group" aria-label={`${c.name}的颜色`}>
        {CATEGORY_PALETTE.map((color) => (
          <button
            type="button"
            key={color}
            className={`category-swatch ${(c.color ?? '').toLowerCase() === color ? 'active' : ''}`}
            style={{ background: color }}
            aria-label={`设为 ${color}`}
            disabled={busy}
            onClick={() => void perform({ kind: 'setColor', id: c.id, color }, '颜色已保存')}
          />
        ))}
        <button
          type="button"
          className="chip"
          disabled={busy}
          onClick={() =>
            void perform({ kind: 'setColor', id: c.id, color: null }, '已恢复自动颜色')
          }
        >
          自动
        </button>
      </div>
    ) : null;

  const renameEditor = (c: CategoryDefinition) =>
    editing === c.id ? (
      <div className="category-rename">
        <label className="field">
          <span>改名会同步历史与统计显示</span>
          <input
            aria-label={`修改${c.name}名称`}
            value={editName}
            disabled={busy}
            maxLength={24}
            onChange={(e) => setEditName(e.target.value)}
          />
        </label>
        <div className="sheet-actions">
          <button className="btn ghost" disabled={busy} onClick={() => setEditing(null)}>
            取消
          </button>
          <button
            className="btn"
            disabled={busy || !editName.trim()}
            onClick={() =>
              void perform(
                { kind: 'rename', id: c.id, name: editName },
                '分类已改名，历史显示已同步',
              )
            }
          >
            保存名称
          </button>
        </div>
      </div>
    ) : null;

  const moveEditor = (c: CategoryDefinition) =>
    move?.id === c.id ? (
      <div className="category-move">
        <label className="field">
          <span>归到哪个大类（大类不能挂在小标签下）</span>
          <select
            aria-label={`${c.name}归属`}
            value={move.parentId}
            disabled={busy}
            onChange={(e) => setMove({ id: c.id, parentId: e.target.value })}
          >
            <option value="">不归大类（作为大类）</option>
            {topUsers
              .filter((p) => p.id !== c.id)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </label>
        <div className="sheet-actions">
          <button className="btn ghost" disabled={busy} onClick={() => setMove(null)}>
            取消
          </button>
          <button
            className="btn"
            disabled={busy}
            onClick={() =>
              void perform(
                { kind: 'setParent', id: c.id, parentId: move.parentId || null },
                '归属已保存',
              )
            }
          >
            保存归属
          </button>
        </div>
      </div>
    ) : null;

  const row = (c: CategoryDefinition, child: boolean) => {
    const kids = child ? 0 : activeChildren(c.id).length;
    const collapsedHere = collapsed[c.id] === true;
    return (
      <div className={`category-management-row ${child ? 'category-child-row' : ''}`} key={c.id}>
        {editing === c.id ? (
          renameEditor(c)
        ) : (
          <>
            <strong className="category-name">
              {colorDot(c)}
              {kids > 0 ? (
                <button
                  type="button"
                  className="category-collapse"
                  aria-expanded={!collapsedHere}
                  aria-label={`${collapsedHere ? '展开' : '收起'}${c.name}的小标签`}
                  disabled={busy}
                  onClick={() =>
                    setCollapsed((current) => ({ ...current, [c.id]: !current[c.id] }))
                  }
                >
                  {collapsedHere ? '▸' : '▾'}
                </button>
              ) : null}
              <span>{c.name}</span>
              {child ? <span className="category-child-tag">小标签</span> : null}
              {kids > 0 ? <span className="category-child-count">{kids} 个小标签</span> : null}
            </strong>
            {colorTarget === c.id ? colorPalette(c) : null}
            <div className="category-row-actions">
              {!child ? (
                <button
                  className="chip"
                  disabled={busy}
                  onClick={() => {
                    setParentForNew(c.id);
                    setName('');
                    setMessage(null);
                    setCollapsed((current) => ({ ...current, [c.id]: false }));
                    nameInput.current?.focus();
                  }}
                >
                  + 小标签
                </button>
              ) : null}
              <button
                className="chip"
                aria-label={`修改${c.name}的归属`}
                disabled={busy}
                onClick={() => setMove({ id: c.id, parentId: c.parentId ?? '' })}
              >
                {child ? '换大类' : '归大类'}
              </button>
              <button
                className="chip"
                aria-label={`上移${c.name}`}
                disabled={busy || isFirstSibling(c)}
                onClick={() => void perform({ kind: 'up', id: c.id }, '顺序已保存')}
              >
                上移
              </button>
              <button
                className="chip"
                aria-label={`下移${c.name}`}
                disabled={busy || isLastSibling(c)}
                onClick={() => void perform({ kind: 'down', id: c.id }, '顺序已保存')}
              >
                下移
              </button>
              <button
                className="chip"
                disabled={busy}
                onClick={() => {
                  setEditing(c.id);
                  setEditName(c.name);
                  setMessage(null);
                }}
              >
                改名
              </button>
              <button
                className="chip"
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      `删除“${c.name}”？有历史记录时只会停用：历史名称、备注和时长保留，之后仍可改标或恢复。`,
                    )
                  )
                    void perform(
                      { kind: 'delete', id: c.id },
                      '已从新记录选项中移除，历史引用仍保留',
                    );
                }}
              >
                删除
              </button>
            </div>
          </>
        )}
        {moveEditor(c)}
      </div>
    );
  };

  return (
    <section className="section category-manager" aria-busy={busy}>
      <div className="section-head">
        <span>分类管理</span>
        <span className="small muted">大类 → 小标签，最多两级</span>
      </div>
      <p className="hint">
        把时间分给你自己的类别。点色块换颜色；删除已使用标签只会停用，历史名称、备注和时长都会保留，之后可以改标或恢复。
      </p>
      <div className="category-add">
        <input
          ref={nameInput}
          aria-label="新分类名称"
          placeholder={parentForNew ? '新小标签名称，例如：学日语' : '新大类名称，例如：工作'}
          value={name}
          maxLength={24}
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
        />
        <select
          aria-label="新分类归属"
          value={parentForNew}
          disabled={busy}
          onChange={(e) => setParentForNew(e.target.value)}
        >
          <option value="">作为大类</option>
          {topUsers.map((p) => (
            <option key={p.id} value={p.id}>
              归到：{p.name}
            </option>
          ))}
        </select>
        <button
          className="btn"
          disabled={busy || !name.trim()}
          onClick={() =>
            void perform(
              {
                kind: 'add',
                id: `cat-${crypto.randomUUID()}`,
                name,
                parentId: parentForNew || null,
              },
              parentForNew ? '小标签已添加' : '大类已添加',
            )
          }
        >
          添加
        </button>
      </div>
      <div className="category-management-list">
        {preSleep ? (
          <div className="category-management-row category-system-row" key={preSleep.id}>
            {editing === preSleep.id ? (
              renameEditor(preSleep)
            ) : (
              <>
                <strong className="category-name">
                  {colorDot(preSleep)}
                  <span>{preSleep.name}</span>
                  <span className="category-system-tag">系统 · 仅可改名</span>
                </strong>
                <div className="category-row-actions">
                  <button
                    className="chip"
                    disabled={busy}
                    onClick={() => {
                      setEditing(preSleep.id);
                      setEditName(preSleep.name);
                      setMessage(null);
                    }}
                  >
                    改名
                  </button>
                </div>
              </>
            )}
          </div>
        ) : null}
        {topUsers.map((parent) => (
          <div className="category-group" key={parent.id}>
            {row(parent, false)}
            {collapsed[parent.id] === true
              ? null
              : activeChildren(parent.id).map((child) => row(child, true))}
          </div>
        ))}
      </div>
      <p className="tiny">
        未分类用于兜底，补觉用于睡眠计算，睡前时间由系统在开启第二天时标记；这三个系统标签不能当小标签。有大类的小标签被删除后仍保留原来的大类，历史显示不会丢。
      </p>
      {archived.length ? (
        <details className="archived-categories">
          <summary>已停用分类（历史仍保留）</summary>
          {archived.map((c) => {
            const parent = c.parentId ? catalog.find((p) => p.id === c.parentId) : null;
            return (
              <div className="category-management-row" key={c.id}>
                <span className="category-name">
                  <span className="category-color-static" aria-hidden="true">
                    <span
                      className="category-color-dot"
                      style={{ background: categoryColor(c.id, catalog) }}
                    />
                  </span>
                  <span>{parent ? `${parent.name} / ${c.name}` : c.name}</span>
                </span>
                <div className="category-row-actions">
                  <button
                    className="chip"
                    disabled={busy}
                    onClick={() => {
                      const next = window.prompt('修改分类名称（同步历史显示）', c.name);
                      if (next !== null)
                        void perform({ kind: 'rename', id: c.id, name: next }, '分类名称已保存');
                    }}
                  >
                    改名
                  </button>
                  <button
                    className="chip"
                    disabled={busy}
                    onClick={() =>
                      void perform({ kind: 'restore', id: c.id }, '分类已恢复，可用于新记录')
                    }
                  >
                    恢复使用
                  </button>
                </div>
              </div>
            );
          })}
        </details>
      ) : null}
      {message ? (
        <p className={message.error ? 'error' : 'status'} role={message.error ? 'alert' : 'status'}>
          {message.text}
        </p>
      ) : null}
    </section>
  );
}
