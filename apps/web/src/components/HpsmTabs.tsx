import { useCallback, useEffect, useRef, useState } from 'react';

import { t } from '../i18n/shell';

/** Folga nas pontas: a aba revelada nao fica embaixo da seta da faixa (1,5rem). */
const ARROW_GAP = 24;

/** Rola so a faixa ate a aba ficar a vista, sem mexer na rolagem da pagina (item 127). */
export function revealTab(bar: HTMLElement | null, tab: Element | null | undefined) {
  if (!bar || !tab) return;
  const b = bar.getBoundingClientRect();
  const r = tab.getBoundingClientRect();
  const gap = bar.scrollWidth > bar.clientWidth ? ARROW_GAP : 0;
  if (r.left < b.left + gap) bar.scrollLeft -= b.left + gap - r.left;
  else if (r.right > b.right - gap) bar.scrollLeft += r.right - (b.right - gap);
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

/**
 * Abas no estilo HP Service Manager (substitui o `cds--tabs` do Carbon). Quando nao cabem, a faixa
 * rola na horizontal e ganha setas nas pontas que tem aba escondida (pendencias da varredura
 * visual, item 3): a barra de rolagem fina quase nao avisa que ha mais abas. As setas sao so para o
 * mouse; pelo teclado, a aba focada rola para a vista.
 */
export function HpsmTabs({ items, active, onChange, ariaLabel }: HpsmTabsProps) {
  const bar = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState({ before: false, after: false });

  const measure = useCallback(() => {
    const el = bar.current;
    if (!el) return;
    const before = el.scrollLeft > 1;
    const after = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setHidden((h) => (h.before === before && h.after === after ? h : { before, after }));
  }, []);

  useEffect(() => revealTab(bar.current, bar.current?.querySelector('.is-active')), [active]);

  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure, items.length]);

  const scrollBy = (direction: 1 | -1) => {
    const el = bar.current;
    if (el) el.scrollBy({ left: direction * el.clientWidth * 0.8 });
  };

  return (
    <div className="hpsm-tabstrip">
      <div
        ref={bar}
        className="hpsm-tabbar"
        role="tablist"
        aria-label={ariaLabel}
        onScroll={measure}
      >
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
              onFocus={(e) => revealTab(bar.current, e.currentTarget)}
            >
              <span className="hpsm-tab__label">{item.label}</span>
              {item.dot && <span className="hpsm-tab__dot" title={item.dotLabel} />}
            </button>
          );
        })}
      </div>
      {hidden.before && (
        <button
          type="button"
          className="hpsm-tabstrip__arrow hpsm-tabstrip__arrow--before"
          tabIndex={-1}
          aria-hidden="true"
          title={t('tabsBefore')}
          onClick={() => scrollBy(-1)}
        >
          ‹
        </button>
      )}
      {hidden.after && (
        <button
          type="button"
          className="hpsm-tabstrip__arrow hpsm-tabstrip__arrow--after"
          tabIndex={-1}
          aria-hidden="true"
          title={t('tabsAfter')}
          onClick={() => scrollBy(1)}
        >
          ›
        </button>
      )}
    </div>
  );
}
