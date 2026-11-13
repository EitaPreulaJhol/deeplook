import type { Verdict } from '../api/types';
import { localized } from '../i18n';
import { t } from '../i18n/kb';

/** Base de conhecimento (item 63). */
export type KbCategory = 'MALWARE_FAMILY' | 'SCAM' | 'TECHNIQUE' | 'PROCEDURE';

export const KB_CATEGORIES: { id: KbCategory; label: string }[] = localized(() => [
  { id: 'MALWARE_FAMILY', label: t('catMalware') },
  { id: 'SCAM', label: t('catScam') },
  { id: 'TECHNIQUE', label: t('catTechnique') },
  { id: 'PROCEDURE', label: t('catProcedure') },
]);

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
