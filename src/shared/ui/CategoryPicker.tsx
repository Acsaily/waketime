import { useMemo, useState } from 'react';
import type { CategoryId } from '../../modules/classification/index';
import {
  categoryPath,
  selectableCategories,
  type CategoryDefinition,
} from '../../modules/classification/index';
import { categoryColor } from '../../modules/classification/index';

function ColorDot({ id, categories }: { id: string; categories: CategoryDefinition[] }) {
  return (
    <i
      className="category-color-dot"
      style={{ background: categoryColor(id, categories) }}
      aria-hidden="true"
    />
  );
}

/**
 * 两级分类选择：第一层大类，第二层小标签；大类本身也可直接选。
 * compact 用于合并/批量场景：按大类分组的扁平 chip，不再下钻。
 */
export function CategoryPicker({
  categories,
  value,
  onChange,
  allowSleep = true,
  originalId,
  compact = false,
  disabled = false,
}: {
  categories: CategoryDefinition[];
  value: CategoryId | null;
  onChange: (id: CategoryId) => void;
  allowSleep?: boolean;
  originalId?: CategoryId;
  compact?: boolean;
  disabled?: boolean;
}) {
  const selectable = useMemo(
    () => selectableCategories(categories, originalId, allowSleep),
    [categories, originalId, allowSleep],
  );
  const [openParentId, setOpenParentId] = useState<string | null>(null);
  const openParent = openParentId ? (selectable.find((c) => c.id === openParentId) ?? null) : null;
  const selectedPath = value ? categoryPath(value, categories) : '';

  if (compact) {
    const top = selectable.filter((c) => !c.parentId);
    return (
      <div className="category-compact" role="group" aria-label="选择分类">
        {top.map((parent) => {
          const children = selectable.filter((c) => c.parentId === parent.id);
          return (
            <div className="category-compact-group" key={parent.id}>
              <button
                type="button"
                className={`category-compact-parent ${value === parent.id ? 'selected' : ''}`}
                aria-pressed={value === parent.id}
                disabled={disabled}
                onClick={() => onChange(parent.id)}
              >
                <ColorDot id={parent.id} categories={categories} />
                {parent.name}
                {children.length ? (
                  <span className="category-compact-hint">（只记大类）</span>
                ) : null}
              </button>
              {children.length ? (
                <div className="category-compact-children">
                  {children.map((child) => (
                    <button
                      type="button"
                      key={child.id}
                      className={`chip ${value === child.id ? 'active' : ''}`}
                      aria-pressed={value === child.id}
                      disabled={disabled}
                      onClick={() => onChange(child.id)}
                    >
                      <ColorDot id={child.id} categories={categories} />
                      {child.name}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  }

  const top = selectable.filter((c) => !c.parentId);
  const children = openParent ? selectable.filter((c) => c.parentId === openParent.id) : [];

  return (
    <div className="category-picker">
      {openParent ? (
        <>
          <div className="category-picker-back">
            <button
              type="button"
              className="chip"
              disabled={disabled}
              onClick={() => setOpenParentId(null)}
            >
              ‹ 全部大类
            </button>
            <strong>
              <ColorDot id={openParent.id} categories={categories} />
              {openParent.name}
            </strong>
          </div>
          <div className="category-tiles">
            <button
              type="button"
              className={`category-tile category-tile-parent ${value === openParent.id ? 'selected' : ''}`}
              aria-pressed={value === openParent.id}
              disabled={disabled}
              onClick={() => onChange(openParent.id)}
            >
              <span
                className="category-tile-dot"
                style={{ background: categoryColor(openParent.id, categories) }}
              />
              <span className="category-tile-name">只记{openParent.name}</span>
              <span className="category-tile-sub">不选细分</span>
            </button>
            {children.map((child) => (
              <button
                type="button"
                key={child.id}
                className={`category-tile ${value === child.id ? 'selected' : ''}`}
                aria-pressed={value === child.id}
                disabled={disabled}
                onClick={() => onChange(child.id)}
              >
                <span
                  className="category-tile-dot"
                  style={{ background: categoryColor(child.id, categories) }}
                />
                <span className="category-tile-name">{child.name}</span>
                {child.archived ? (
                  <span className="category-tile-sub">已停用 · 仅原记录</span>
                ) : null}
              </button>
            ))}
          </div>
          <p className="tiny">
            选中后记录为「{categoryPath(value ?? openParent.id, categories)}」。
          </p>
        </>
      ) : (
        <>
          <div className="category-tiles">
            {top.map((parent) => {
              const hasChildren = selectable.some((c) => c.parentId === parent.id);
              const selectedChild = value
                ? selectable.find((c) => c.id === value && c.parentId === parent.id)
                : null;
              return (
                <button
                  type="button"
                  key={parent.id}
                  className={`category-tile ${value === parent.id || selectedChild ? 'selected' : ''}`}
                  aria-pressed={value === parent.id || !!selectedChild}
                  disabled={disabled}
                  onClick={() => (hasChildren ? setOpenParentId(parent.id) : onChange(parent.id))}
                >
                  <span
                    className="category-tile-dot"
                    style={{ background: categoryColor(parent.id, categories) }}
                  />
                  <span className="category-tile-name">{parent.name}</span>
                  <span className="category-tile-sub">
                    {selectedChild
                      ? `当前：${selectedChild.name}`
                      : hasChildren
                        ? `${selectable.filter((c) => c.parentId === parent.id).length} 个细分 ›`
                        : parent.archived
                          ? '已停用 · 仅原记录'
                          : '直接选择'}
                  </span>
                </button>
              );
            })}
          </div>
          {selectedPath ? <p className="tiny">当前：{selectedPath}</p> : null}
        </>
      )}
    </div>
  );
}
