import { TextArea } from '@carbon/react';
import { useQuery } from '@tanstack/react-query';
import type { ComponentProps, KeyboardEvent, ReactNode, SyntheticEvent } from 'react';
import { useId, useRef, useState } from 'react';

import { api } from '../api/client';

export interface Mention {
  id: string;
  name: string;
}

/** "@" seguido do termo, logo antes do cursor (inicio do texto ou apos espaco). */
const TRIGGER = /(?:^|\s)@([\p{L}\p{N}._-]{0,30})$/u;

type Props = Omit<ComponentProps<typeof TextArea>, 'value' | 'onChange'> & {
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** Pessoa escolhida no autocompletar (o pai guarda para enviar os ids). */
  onMention: (mention: Mention) => void;
  /** So analistas na lista (comentarios de casos, item 89). */
  analystsOnly?: boolean;
};

/**
 * Campo de texto com mencoes: digitar "@" abre a lista de pessoas ativas
 * (filtrada pelo que vem depois); setas escolhem, Enter ou Tab inserem
 * "@Nome", Esc fecha. O texto guarda so o nome; os ids vao a parte.
 */
export function MentionTextArea({
  id,
  value,
  onChange,
  onMention,
  analystsOnly = false,
  ...rest
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const listId = useId();
  const [trigger, setTrigger] = useState<{ query: string; start: number } | null>(null);
  const [active, setActive] = useState(0);

  const users = useQuery({
    queryKey: ['mentionable', trigger?.query ?? '', analystsOnly],
    queryFn: () =>
      api.get<{ users: { id: string; displayName: string }[] }>(
        `/users/mentionable?q=${encodeURIComponent(trigger?.query ?? '')}${
          analystsOnly ? '&analysts=1' : ''
        }`,
      ),
    enabled: trigger !== null,
    staleTime: 30_000,
  });
  const options = trigger ? (users.data?.users ?? []) : [];
  const listOpen = trigger !== null && options.length > 0;

  // Reavalia o "@termo" antes do cursor a cada digitacao ou movimento do cursor.
  const updateTrigger = (el: HTMLTextAreaElement) => {
    const before = el.value.slice(0, el.selectionStart ?? el.value.length);
    const match = before.match(TRIGGER);
    if (match) {
      setTrigger({ query: match[1], start: before.length - match[1].length - 1 });
      setActive(0);
    } else {
      setTrigger(null);
    }
  };

  const pick = (user: { id: string; displayName: string }) => {
    const el = ref.current;
    if (!el || !trigger) return;
    const caret = el.selectionStart ?? value.length;
    const inserted = `@${user.displayName} `;
    const next = value.slice(0, trigger.start) + inserted + value.slice(caret);
    onChange(next);
    onMention({ id: user.id, name: user.displayName });
    setTrigger(null);
    const pos = trigger.start + inserted.length;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!listOpen) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (i + delta + options.length) % options.length);
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      pick(options[Math.min(active, options.length - 1)]);
    } else if (event.key === 'Escape') {
      // So fecha a lista (nao propaga para dialogos/atalhos).
      event.preventDefault();
      event.stopPropagation();
      setTrigger(null);
    }
  };

  const optionId = (i: number) => `${listId}-opt-${i}`;
  let list: ReactNode = null;
  if (listOpen) {
    list = (
      <ul id={listId} className="dl-mention-list" role="listbox" aria-label="Mencionar">
        {options.map((user, i) => (
          <li
            key={user.id}
            id={optionId(i)}
            role="option"
            aria-selected={i === active}
            className={i === active ? 'is-active' : undefined}
            // mousedown: escolhe antes de o campo perder o foco.
            onMouseDown={(event) => {
              event.preventDefault();
              pick(user);
            }}
          >
            @{user.displayName}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="dl-mention">
      <TextArea
        {...rest}
        ref={ref}
        id={id}
        value={value}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={listOpen}
        aria-controls={listOpen ? listId : undefined}
        aria-activedescendant={listOpen ? optionId(active) : undefined}
        onChange={(event) => {
          onChange(event.target.value);
          updateTrigger(event.target);
        }}
        onKeyDown={onKeyDown}
        onSelect={(event: SyntheticEvent<HTMLTextAreaElement>) =>
          updateTrigger(event.currentTarget)
        }
        onBlur={() => setTrigger(null)}
      />
      {list}
    </div>
  );
}

/** Mencoes gravadas no evento (JSON em `toValue`); invalido ou vazio = nenhuma. */
function parseMentions(json?: string | null): Mention[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as Mention[]) : [];
  } catch {
    return [];
  }
}

/**
 * Texto de uma atualizacao com as mencoes destacadas: os "@Nome" das pessoas
 * mencionadas (gravadas em `toValue`, JSON) viram negrito; o resto e texto puro.
 */
export function renderMentions(text: string, mentionsJson?: string | null): ReactNode {
  const mentions = parseMentions(mentionsJson);
  const names = mentions.map((m) => m.name).filter(Boolean);
  if (!names.length) return text;
  const escaped = names
    .sort((a, b) => b.length - a.length)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const parts = text.split(new RegExp(`(@(?:${escaped.join('|')}))`, 'g'));
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <strong key={i} className="dl-mention-tag">
        {part}
      </strong>
    ) : (
      part
    ),
  );
}
