import type { EntryStatus, EntryType, IocKind, Priority, Verdict } from '../api/types';
import { localized } from '../i18n';
import { t } from '../i18n/cases';
import type { StatusTone } from './tags';

/** Casos (item 55): agrupam amostras da mesma campanha (so analistas). */
export type CaseStatus = 'OPEN' | 'IN_PROGRESS' | 'CLOSED';

export const CASE_STATUS: Record<CaseStatus, { label: string; tone: StatusTone }> = localized(
  () => ({
    OPEN: { label: t('stOpen'), tone: 'orange' },
    IN_PROGRESS: { label: t('stInProgress'), tone: 'blue' },
    CLOSED: { label: t('stClosed'), tone: 'green' },
  }),
);

type Person = { id: string; displayName: string } | null;

export interface CaseSummary {
  id: string;
  number: number;
  code: string;
  title: string;
  status: CaseStatus;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  assignee: Person;
  createdBy: Person;
  /** Quantas amostras. */
  entries: number;
}

export type CaseEventType =
  | 'CREATED'
  | 'ENTRY_ADDED'
  | 'ENTRY_REMOVED'
  | 'STATUS_CHANGED'
  | 'ASSIGNED'
  | 'UPDATED'
  | 'COMMENT';

export interface CaseDetail extends Omit<CaseSummary, 'entries'> {
  description: string | null;
  entries: {
    addedAt: string;
    addedBy: Person;
    entry: {
      id: string;
      title: string;
      type: EntryType;
      status: EntryStatus;
      verdict: Verdict;
      priority: Priority;
      createdAt: string;
      sha256: string | null;
      url: string | null;
      reports: {
        id: string;
        summary: string;
        findings: string | null;
        iocs: string | null;
        verdict: Verdict;
        updatedAt: string;
        analyst: Person;
        attackTechniques: string[];
        /** Imagens de evidencia (item 76). */
        evidence: { id: string; caption: string | null; width: number; height: number }[];
      }[];
    };
  }[];
  events: {
    id: string;
    type: CaseEventType;
    detail: string | null;
    fromValue: string | null;
    toValue: string | null;
    createdAt: string;
    actor: Person;
    entry: { id: string; title: string } | null;
  }[];
}

export const caseHref = (id: string) => `/casos/${id}`;

/** Indicador das amostras do caso, sem repetir (GET /api/cases/:id/iocs). */
export interface CaseIoc {
  kind: IocKind | 'URL';
  value: string;
  source: 'REPORT' | 'SAMPLE';
  entries: { id: string; title: string; verdict: Verdict }[];
}

type CaseEvent = CaseDetail['events'][number];

/** Texto de um evento da linha do tempo do caso (sem o autor). */
export function caseEventText(e: CaseEvent, names: Map<string, string>): string {
  switch (e.type) {
    case 'CREATED':
      return t('evCreated');
    case 'ENTRY_ADDED':
      return t('evEntryAdded', { title: e.entry?.title ?? t('removedParen') });
    case 'ENTRY_REMOVED':
      return t('evEntryRemoved', { title: e.entry?.title ?? t('removedParen') });
    case 'STATUS_CHANGED':
      return t('evStatus', {
        from: CASE_STATUS[e.fromValue as CaseStatus]?.label ?? e.fromValue,
        to: CASE_STATUS[e.toValue as CaseStatus]?.label ?? e.toValue,
      });
    case 'ASSIGNED':
      return e.toValue
        ? t('evAssigned', { name: names.get(e.toValue) ?? t('otherAnalyst') })
        : t('evUnassigned');
    case 'UPDATED':
      return e.detail ? t('evRenamed', { title: e.detail }) : t('evDescription');
    case 'COMMENT':
      return t('evComment');
  }
}

/**
 * Tecnicas ATT&CK dos relatorios publicados do caso, sem repetir, com as
 * amostras onde aparecem (na ordem de codigo).
 */
export function caseTechniques(c: CaseDetail): { id: string; entries: string[] }[] {
  const found = new Map<string, Set<string>>();
  for (const { entry } of c.entries) {
    for (const report of entry.reports) {
      for (const id of report.attackTechniques) {
        found.set(id, (found.get(id) ?? new Set()).add(entry.title));
      }
    }
  }
  return [...found.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, entries]) => ({ id, entries: [...entries] }));
}
