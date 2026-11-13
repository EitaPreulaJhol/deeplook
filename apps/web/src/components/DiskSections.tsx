import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from '@carbon/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { api } from '../api/client';
import type { StaticInfo } from '../api/types';
import { intlLocale, localized } from '../i18n';
import { t } from '../i18n/analysis';
import { useConfirm } from './HpsmConfirm';
import { formatFileSize } from './HpsmFileDrop';
import { HpsmField, HpsmForm, HpsmReadonly, HpsmSection } from './HpsmForm';
import { HpsmToolbar, HpsmToolbarButton } from './HpsmToolbar';
import { HpsmMessage } from './messages';
import { StatusTag, StatusText, VerdictTag } from './tags';

function fmtDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString(intlLocale()) : '—';
}

const WINDOW = localized(() => ({
  normal: t('winNormal'),
  maximized: t('winMax'),
  minimized: t('winMin'),
}));

/** Aviso no topo: atalho que abre interpretador/binario do sistema. */
export function LnkWarning({ info }: { info?: StaticInfo | null }) {
  const lnk = info?.lnk;
  if (!lnk || !lnk.alerts.length) return null;
  return (
    <HpsmMessage kind="warning">
      {t(lnk.arguments ? 'lnkWarnArgs' : 'lnkWarn', {
        target: lnk.target ?? t('aProgram'),
        alert: lnk.alerts[0],
      })}
    </HpsmMessage>
  );
}

/** Secao "Atalho do Windows (.lnk)" (item 84). */
export function LnkSection({ info }: { info?: StaticInfo | null }) {
  const lnk = info?.lnk;
  if (!lnk) return null;
  const command = [lnk.target, lnk.arguments].filter(Boolean).join(' ');
  return (
    <HpsmSection title={t('lnkTitle')} className="dl-mt-lg">
      <HpsmForm columns={2}>
        <HpsmField label={t('target')} wide>
          <HpsmReadonly
            mono
            copyable={lnk.target ? { value: lnk.target, label: 'destino' } : undefined}
          >
            {lnk.target ?? '—'}
          </HpsmReadonly>
        </HpsmField>
        <HpsmField label={t('arguments')} wide top help={t('argumentsHelp')}>
          <HpsmReadonly
            multiline
            mono
            copyable={command ? { value: command, label: t('fullCommand') } : undefined}
          >
            {lnk.arguments || '—'}
          </HpsmReadonly>
        </HpsmField>
        <HpsmField label={t('directory')}>
          <HpsmReadonly mono>{lnk.workingDir ?? '—'}</HpsmReadonly>
        </HpsmField>
        <HpsmField label={t('window')}>
          <HpsmReadonly>
            {lnk.window === 'minimized' ? (
              <StatusText tone="orange">{WINDOW[lnk.window]}</StatusText>
            ) : (
              WINDOW[lnk.window]
            )}
          </HpsmReadonly>
        </HpsmField>
        <HpsmField label={t('icon')}>
          <HpsmReadonly mono>{lnk.iconLocation ?? '—'}</HpsmReadonly>
        </HpsmField>
        <HpsmField label={t('description')}>
          <HpsmReadonly>{lnk.description ?? '—'}</HpsmReadonly>
        </HpsmField>
        <HpsmField label={t('sourceMachine')}>
          <HpsmReadonly mono>
            {lnk.machine ?? '—'}
            {lnk.mac ? ` · MAC ${lnk.mac}` : ''}
          </HpsmReadonly>
        </HpsmField>
        <HpsmField label={t('targetDates')}>
          <HpsmReadonly>
            {t('createdModified', {
              created: fmtDate(lnk.created),
              modified: fmtDate(lnk.modified),
            })}
          </HpsmReadonly>
        </HpsmField>
        {lnk.alerts.length > 0 && (
          <HpsmField label={t('alerts')} wide top>
            <ul className="dl-doc-alerts">
              {lnk.alerts.map((a) => (
                <li key={a}>
                  <StatusText tone="red">{a}</StatusText>
                </li>
              ))}
            </ul>
          </HpsmField>
        )}
      </HpsmForm>
    </HpsmSection>
  );
}

interface Child {
  id: string;
  title: string;
  originalFilename: string | null;
  status: 'PENDING' | 'IN_REVIEW' | 'COMPLETED';
  verdict: 'UNKNOWN' | 'CLEAN' | 'SUSPICIOUS' | 'MALICIOUS';
}

const FORMAT = localized(() => ({
  iso9660: 'ISO 9660',
  fat: 'FAT',
  'vhd-fat': 'VHD (FAT)',
  unsupported: t('notListed'),
}));

/**
 * Secao "Imagem de disco" (item 84): arquivos da ISO/IMG/VHD (ocultos marcados),
 * alertas e, para analistas, "Extrair como amostras" (cada arquivo vira uma
 * amostra filha, analisada como um envio).
 */
export function DiskImageSection({
  entryId,
  info,
  canTriage,
  purged,
}: {
  entryId: string;
  info?: StaticInfo | null;
  canTriage: boolean;
  purged: boolean;
}) {
  const image = info?.diskImage;
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const childrenQuery = useQuery({
    queryKey: ['entry', entryId, 'children'],
    queryFn: () => api.get<{ children: Child[] }>(`/entries/${entryId}/children`),
    enabled: Boolean(image),
  });
  if (!image) return null;
  const children = childrenQuery.data?.children ?? [];

  const extract = async () => {
    const ok = await confirm({
      title: t('extractFiles'),
      message: t('extractConfirm', {
        n: Math.min(image.files.length, 50),
        label: image.label ?? t('image'),
      }),
      confirmLabel: t('extract'),
      cancelLabel: t('cancel'),
    });
    if (!ok) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await api.post<{ created: number; skipped: { path: string; reason: string }[] }>(
        `/entries/${entryId}/extract-image`,
      );
      setMsg({
        ok: true,
        text:
          t('extractedAsSamples', { n: res.created }) +
          (res.skipped.length
            ? ` ${t('skippedFiles', { list: res.skipped.map((s) => `${s.path} (${s.reason})`).join('; ') })}`
            : ''),
      });
      await queryClient.invalidateQueries({ queryKey: ['entry', entryId] });
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <HpsmSection title={t('diskImage', { format: FORMAT[image.format] })} className="dl-mt-lg">
      {canTriage && image.files.length > 0 && children.length === 0 && (
        <HpsmToolbar label={t('imageActions')}>
          <HpsmToolbarButton
            label={busy ? t('extracting') : t('extractAsSamples')}
            disabled={busy || purged}
            title={purged ? t('filePurgedShort') : t('eachFileChild')}
            onClick={() => void extract()}
          />
        </HpsmToolbar>
      )}
      {msg && (
        <HpsmMessage key={msg.text} kind={msg.ok ? 'success' : 'error'}>
          {msg.text}
        </HpsmMessage>
      )}
      <HpsmForm columns={2}>
        <HpsmField label={t('label')}>
          <HpsmReadonly>{image.label ?? '—'}</HpsmReadonly>
        </HpsmField>
        <HpsmField label={t('files')}>
          <HpsmReadonly>
            {image.files.length}
            {image.truncated ? ` ${t('listCut500')}` : ''}
          </HpsmReadonly>
        </HpsmField>
        {image.note && (
          <HpsmField label={t('note')} wide>
            <HpsmReadonly>{image.note}</HpsmReadonly>
          </HpsmField>
        )}
        {image.alerts.length > 0 && (
          <HpsmField label={t('alerts')} wide top>
            <ul className="dl-doc-alerts">
              {image.alerts.map((a) => (
                <li key={a}>
                  <StatusText tone="red">{a}</StatusText>
                </li>
              ))}
            </ul>
          </HpsmField>
        )}
      </HpsmForm>
      {image.files.length > 0 && (
        <TableContainer>
          <Table size="xs" aria-label={t('imageFilesAria')}>
            <TableHead>
              <TableRow>
                <TableHeader scope="col">{t('file')}</TableHeader>
                <TableHeader scope="col">{t('size')}</TableHeader>
                <TableHeader scope="col">{t('sample')}</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {image.files.map((f) => {
                const child = children.find((c) => c.title === f.path);
                return (
                  <TableRow key={f.path}>
                    <TableCell className="dl-mono">
                      {f.path}
                      {f.hidden && <StatusText tone="orange"> {t('hidden')}</StatusText>}
                    </TableCell>
                    <TableCell>{formatFileSize(f.size)}</TableCell>
                    <TableCell>
                      {child ? (
                        <span className="dl-row-actions">
                          <Link className="dl-link" to={`/entries/${child.id}`}>
                            {t('open')}
                          </Link>
                          <StatusTag status={child.status} />
                          <VerdictTag verdict={child.verdict} />
                        </span>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </HpsmSection>
  );
}
