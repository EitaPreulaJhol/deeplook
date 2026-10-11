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
  return (
    <div className="hpsm-tabbar" role="tablist" aria-label={ariaLabel}>
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
