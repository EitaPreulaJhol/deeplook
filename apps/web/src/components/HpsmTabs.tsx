export interface HpsmTabItem {
  id: string;
  label: string;
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
          </button>
        );
      })}
    </div>
  );
}
