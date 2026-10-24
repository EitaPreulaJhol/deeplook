import type { EntryStatus, EntryType, Priority, Verdict } from '../api/types';
import type { StatusTone } from './tags';

/** Casos (item 55): agrupam amostras da mesma campanha (so analistas). */
export type CaseStatus = 'OPEN' | 'IN_PROGRESS' | 'CLOSED';

export const CASE_STATUS: Record<CaseStatus, { label: string; tone: StatusTone }> = {
  OPEN: { label: 'Aberto', tone: 'orange' },
  IN_PROGRESS: { label: 'Em andamento', tone: 'blue' },
  CLOSED: { label: 'Encerrado', tone: 'green' },
};

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
      reports: {
        id: string;
        summary: string;
        verdict: Verdict;
        updatedAt: string;
        analyst: Person;
        attackTechniques: string[];
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
