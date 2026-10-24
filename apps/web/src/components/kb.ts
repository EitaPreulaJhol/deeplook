import type { Verdict } from '../api/types';

/** Base de conhecimento (item 63). */
export type KbCategory = 'MALWARE_FAMILY' | 'SCAM' | 'TECHNIQUE' | 'PROCEDURE';

export const KB_CATEGORIES: { id: KbCategory; label: string }[] = [
  { id: 'MALWARE_FAMILY', label: 'Família de malware' },
  { id: 'SCAM', label: 'Golpe' },
  { id: 'TECHNIQUE', label: 'Técnica' },
  { id: 'PROCEDURE', label: 'Procedimento' },
];

export const kbCategoryLabel = (id: KbCategory) =>
  KB_CATEGORIES.find((c) => c.id === id)?.label ?? id;

type Person = { id: string; displayName: string } | null;

export interface KbArticleSummary {
  id: string;
  title: string;
  summary: string;
  category: KbCategory;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  updatedBy: Person;
  /** Relatorios publicados que citam o artigo. */
  citations?: number;
}

export interface KbArticle extends KbArticleSummary {
  body: string;
  createdBy: Person;
  canDelete: boolean;
  revisions: { id: string; createdAt: string; editor: Person }[];
  reports: {
    id: string;
    updatedAt: string;
    analyst: Person;
    entry: { id: string; title: string; verdict: Verdict };
  }[];
}

export const kbHref = (id: string) => `/kb/${id}`;
