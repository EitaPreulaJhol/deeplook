import { describe, expect, it } from 'vitest';

import type { AppNotification, NotificationType } from '../api/types';
import {
  NOTIFICATION_TYPE_LABELS,
  notificationHref,
  notificationQuote,
  notificationResolution,
  notificationTarget,
  notificationText,
} from './notifications';

/** Notificacao minima valida; cada teste sobrescreve so o que importa. */
function mk(partial: Partial<AppNotification> & { type: NotificationType }): AppNotification {
  return {
    id: 'n1',
    detail: null,
    readAt: null,
    createdAt: '2024-01-01T00:00:00Z',
    entry: { id: 'e1', title: 'Amostra X' },
    actor: { id: 'u1', displayName: 'Bruno Lima' },
    ...partial,
  };
}

describe('notificationText', () => {
  it('usa o nome de quem agiu', () => {
    expect(notificationText(mk({ type: 'ASSIGNED' }))).toBe('Bruno Lima atribuiu a amostra a você');
  });

  it('o veredito da amostra concluida entra entre parenteses quando ha detalhe', () => {
    expect(notificationText(mk({ type: 'COMPLETED', detail: 'MALICIOUS' }))).toBe(
      'Bruno Lima concluiu a sua amostra (veredito: Malicioso)',
    );
    expect(notificationText(mk({ type: 'COMPLETED', detail: null }))).toBe(
      'Bruno Lima concluiu a sua amostra',
    );
  });

  it('avisos do sistema (actor null) caem em "O sistema"', () => {
    expect(notificationText(mk({ type: 'COMMENT', actor: null }))).toBe(
      'O sistema escreveu uma atualização',
    );
  });

  it('SLA e YARA montam a frase com o detalhe', () => {
    expect(notificationText(mk({ type: 'SLA_WARN', actor: null, detail: '24' }))).toBe(
      'Prazo em alerta: mais de 24 h no mesmo status',
    );
    expect(notificationText(mk({ type: 'YARA_PACK_UPDATE', detail: 'v2' }))).toBe(
      'Pacotes de regras: v2',
    );
  });
});

describe('notificationResolution', () => {
  it('vem do detalhe no RESOLUTION e da amostra no COMPLETED', () => {
    expect(notificationResolution(mk({ type: 'RESOLUTION', detail: 'reinstale a maquina' }))).toBe(
      'reinstale a maquina',
    );
    expect(
      notificationResolution(
        mk({ type: 'COMPLETED', entry: { id: 'e1', title: 'X', resolution: 'bloqueado' } }),
      ),
    ).toBe('bloqueado');
  });

  it('e null fora desses dois casos (ou sem resolucao)', () => {
    expect(notificationResolution(mk({ type: 'COMPLETED' }))).toBeNull();
    expect(notificationResolution(mk({ type: 'ASSIGNED' }))).toBeNull();
  });
});

describe('notificationQuote', () => {
  it('cita o trecho so nos tipos de atualizacao/comentario', () => {
    expect(notificationQuote(mk({ type: 'MENTION', detail: 'olha isto' }))).toBe('olha isto');
    expect(notificationQuote(mk({ type: 'ASSIGNED', detail: 'olha isto' }))).toBeNull();
  });
});

describe('notificationTarget', () => {
  it('mostra o caso, o titulo da amostra ou um travessao', () => {
    expect(
      notificationTarget(
        mk({
          type: 'CASE_COMMENT',
          case: { id: 'c1', number: 1, title: 'Phishing', code: 'CASO-0001' },
        }),
      ),
    ).toBe('CASO-0001 · Phishing');
    expect(notificationTarget(mk({ type: 'ASSIGNED' }))).toBe('Amostra X');
    expect(notificationTarget(mk({ type: 'YARA_PACK_UPDATE', entry: null }))).toBe(
      'Pacotes de regras YARA',
    );
    expect(notificationTarget(mk({ type: 'COMMENT', entry: null }))).toBe('—');
  });
});

describe('notificationHref', () => {
  it('atualizacoes abrem o historico; aprovacao/devolucao abrem os relatorios', () => {
    expect(notificationHref(mk({ type: 'MENTION' }))).toBe('/entries/e1?tab=historico');
    expect(notificationHref(mk({ type: 'REPORT_APPROVED' }))).toBe('/entries/e1?tab=relatorios');
    expect(
      notificationHref(mk({ type: 'IOC_SEEN', detail: 'apareceu num relatório publicado' })),
    ).toBe('/entries/e1?tab=relatorios');
  });

  it('casos abrem o caso; YARA abre as configuracoes; o resto abre a amostra', () => {
    expect(
      notificationHref(
        mk({ type: 'CASE_ASSIGNED', case: { id: 'c1', number: 1, title: 'P', code: 'CASO-0001' } }),
      ),
    ).toBe('/casos/c1');
    expect(notificationHref(mk({ type: 'YARA_PACK_UPDATE' }))).toBe('/admin?tab=settings');
    expect(notificationHref(mk({ type: 'ASSIGNED' }))).toBe('/entries/e1');
  });
});

describe('NOTIFICATION_TYPE_LABELS', () => {
  it('cobre os dezesseis tipos de aviso', () => {
    expect(Object.keys(NOTIFICATION_TYPE_LABELS)).toHaveLength(16);
    expect(NOTIFICATION_TYPE_LABELS.ASSIGNED).toBe('Amostra atribuída a você');
    expect(NOTIFICATION_TYPE_LABELS.YARA_PACK_UPDATE).toBe(
      'Atualização dos pacotes de regras YARA',
    );
  });
});
