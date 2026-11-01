import { useEffect, useRef } from 'react';

/** Rola so a faixa ate a aba ficar a vista, sem mexer na rolagem da pagina (item 127). */
export function revealTab(bar: HTMLElement | null, tab: Element | null | undefined) {
  if (!bar || !tab) return;
  const b = bar.getBoundingClientRect();
  const t = tab.getBoundingClientRect();
  if (t.left < b.left) bar.scrollLeft -= b.left - t.left;
  else if (t.right > b.right) bar.scrollLeft += t.right - b.right;
}

export interface HpsmTabItem {
  id: string;
  label: string;
  /** Bolinha de destaque apos o rotulo (ex.: ambiente isolado ativo). */
  dot?: boolean;
  /** Texto de ajuda do indicador `dot`. */
  dotLabel?: string;
}

interface HpsmTabsProps {
  items: HpsmTabItem[];
  /** id da aba ativa. */
  active: string;
  onChange: (id: string) => void;
  ariaLabel?: string;
}

/** Abas no estilo HP Service Manager (substitui o `cds--tabs` do Carbon). */
export function HpsmTabs({ items, active, onChange, ariaLabel }: HpsmTabsProps) {
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => revealTab(bar.current, bar.current?.querySelector('.is-active')), [active]);
  return (
    <div ref={bar} className="hpsm-tabbar" role="tablist" aria-label={ariaLabel}>
      {items.map((item) => {
        const selected = item.id === active;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={selected}
            className={`hpsm-tab${selected ? ' is-active' : ''}`}
            onClick={() => onChange(item.id)}
          >
            <span className="hpsm-tab__label">{item.label}</span>
            {item.dot && <span className="hpsm-tab__dot" title={item.dotLabel} />}
          </button>
        );
      })}
    </div>
  );
}
