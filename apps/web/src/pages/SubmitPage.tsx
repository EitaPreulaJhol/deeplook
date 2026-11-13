import {
  Checkbox,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  TextArea,
  TextInput,
} from '@carbon/react';
import { useQuery } from '@tanstack/react-query';
import type { KeyboardEvent } from 'react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { api, ApiError } from '../api/client';
import type { Entry } from '../api/types';
import { formatFileSize, HpsmFileDrop } from '../components/HpsmFileDrop';
import {
  HpsmField,
  HpsmForm,
  HpsmReadonly,
  HpsmSection,
  useRequiredFields,
} from '../components/HpsmForm';
import { HpsmTabs } from '../components/HpsmTabs';
import { HpsmToolbar, HpsmToolbarButton } from '../components/HpsmToolbar';
import { IconAdd, IconArrowLeft } from '../components/icons';
import { HpsmLoading, HpsmMessage } from '../components/messages';
import { PageHeader } from '../components/PageHeader';
import { useSaveShortcut } from '../components/shortcuts';
import type { StatusTone } from '../components/tags';
import { StatusText, VerdictTag } from '../components/tags';
import { useUnsavedChanges } from '../components/useUnsavedChanges';
import { intlLocale, localized } from '../i18n';
import { t } from '../i18n/submit';

/**
 * SHA-256 do arquivo calculado no navegador + amostra ja enviada com o mesmo
 * hash (se houver). Sem `crypto.subtle` (HTTP sem TLS fora do localhost) nao
 * ha checagem e o envio segue normal.
 */
function useDuplicateCheck(file: File | null) {
  const [hash, setHash] = useState<string | null>(null);
  const [hashing, setHashing] = useState(false);
  const [duplicate, setDuplicate] = useState<Entry | null>(null);

  useEffect(() => {
    setHash(null);
    setDuplicate(null);
    if (!file || !window.crypto?.subtle) return;

    let cancelled = false;
    setHashing(true);
    (async () => {
      try {
        const digest = await window.crypto.subtle.digest('SHA-256', await file.arrayBuffer());
        const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join(
          '',
        );
        if (cancelled) return;
        setHash(hex);
        const res = await api.get<{ items: Entry[] }>(`/entries?scope=all&limit=1&sha256=${hex}`);
        if (!cancelled) setDuplicate(res.items[0] ?? null);
      } catch {
        /* sem checagem de duplicata: o envio continua permitido */
      } finally {
        if (!cancelled) setHashing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file]);

  return { hash, hashing, duplicate };
}

/** Arquivos por envio em lote (o .zip tem o mesmo limite no servidor). */
const MAX_FILES = 20;

type Previous = { id: string; title: string } | null;

/** Linha do "Resultado do envio" (lote de arquivos ou conteudo do .zip). */
interface BatchRow {
  key: string;
  name: string;
  size?: number;
  status: 'waiting' | 'sending' | 'done' | 'skipped' | 'error';
  entry?: { id: string; title: string };
  previous?: Previous;
  reason?: string;
}

interface ZipResult {
  created: {
    name: string;
    path: string;
    entry: { id: string; title: string; fileSize: number | null };
    previous: Previous;
  }[];
  skipped: { name: string; path: string; reason: string }[];
}

const ROW_STATUS: Record<BatchRow['status'], { label: string; tone: StatusTone }> = localized(
  () => ({
    waiting: { label: t('rowWaiting'), tone: 'gray' },
    sending: { label: t('sending'), tone: 'blue' },
    done: { label: t('rowSent'), tone: 'green' },
    skipped: { label: t('rowSkipped'), tone: 'orange' },
    error: { label: t('rowFailed'), tone: 'red' },
  }),
);

const isZipName = (name: string) => /\.zip$/i.test(name);

function zipRows(result: ZipResult): BatchRow[] {
  return [
    ...result.created.map((c): BatchRow => ({
      key: `c:${c.path}`,
      name: c.path,
      size: c.entry.fileSize ?? undefined,
      status: 'done',
      entry: c.entry,
      previous: c.previous,
    })),
    ...result.skipped.map((s): BatchRow => ({
      key: `s:${s.path}`,
      name: s.path,
      status: 'skipped',
      reason: s.reason,
    })),
  ];
}

/** Resultado do envio em lote: uma linha por arquivo, atualizada ao vivo. */
function BatchResult({ rows, source }: { rows: BatchRow[]; source: string }) {
  const done = rows.filter((r) => r.status === 'done').length;
  const running = rows.some((r) => r.status === 'waiting' || r.status === 'sending');
  const failed = rows.length - done;
  return (
    <HpsmSection title={t('batchTitle', { source })}>
      {!running &&
        (failed === 0 ? (
          <HpsmMessage kind="success">
            {done === 1 ? t('createdOne') : t('createdMany', { n: done })}
          </HpsmMessage>
        ) : (
          <HpsmMessage kind={done ? 'warning' : 'error'}>
            {t(done === 1 ? 'createdOneShort' : 'createdManyShort', { n: done })};{' '}
            {t(failed === 1 ? 'failedOne' : 'failedMany', { n: failed })}. {t('seeReasons')}
          </HpsmMessage>
        ))}
      <TableContainer>
        <Table size="xs" aria-label={t('batchAria')}>
          <TableHead>
            <TableRow>
              <TableHeader scope="col">{t('file')}</TableHeader>
              <TableHeader scope="col">{t('size')}</TableHeader>
              <TableHeader scope="col">{t('situation')}</TableHeader>
              <TableHeader scope="col">{t('sample')}</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.key}>
                <TableCell>
                  <span className="dl-mono">{row.name}</span>
                </TableCell>
                <TableCell>{formatFileSize(row.size)}</TableCell>
                <TableCell>
                  <StatusText tone={ROW_STATUS[row.status].tone}>
                    {ROW_STATUS[row.status].label}
                    {row.reason ? `: ${row.reason}` : ''}
                  </StatusText>
                </TableCell>
                <TableCell>
                  {row.entry ? (
                    <>
                      <Link className="dl-link" to={`/entries/${row.entry.id}`}>
                        {row.entry.title}
                      </Link>
                      {row.previous && (
                        <span className="dl-batch__previous">
                          {' '}
                          {t('alreadySent')}{' '}
                          <Link className="dl-link" to={`/entries/${row.previous.id}`}>
                            {row.previous.title}
                          </Link>
                        </span>
                      )}
                    </>
                  ) : (
                    '—'
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </HpsmSection>
  );
}

export function SubmitPage() {
  const navigate = useNavigate();

  const [files, setFiles] = useState<File[]>([]);
  const file = files.length === 1 ? files[0] : null;
  const [unzip, setUnzip] = useState(false);
  const [zipPassword, setZipPassword] = useState('infected');
  const [batch, setBatch] = useState<{ source: string; rows: BatchRow[] } | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [url, setUrl] = useState('');
  const [urlTitle, setUrlTitle] = useState('');
  const [urlDescription, setUrlDescription] = useState('');
  const [urlTags, setUrlTags] = useState('');
  const [tab, setTab] = useState('file');
  // Cota de envio (item 64): usuarios comuns, ultimas 24 horas.
  const quotaQuery = useQuery({
    queryKey: ['me', 'upload-quota'],
    queryFn: () =>
      api.get<{
        limit: number | null;
        used: number;
        remaining: number | null;
        resetAt: string | null;
        maxUploadMb: number;
      }>('/me/upload-quota'),
  });
  const quota = quotaQuery.data?.limit ? quotaQuery.data : null;
  const quotaFull = quota?.remaining === 0;
  // Limite por arquivo (item 129): recusa antes de enviar; a API continua conferindo.
  const maxUploadMb = quotaQuery.data?.maxUploadMb ?? null;
  const tooBig = maxUploadMb ? files.filter((f) => f.size > maxUploadMb * 1024 * 1024) : [];
  const { hash, hashing, duplicate } = useDuplicateCheck(file);
  const zipMode = Boolean(file && isZipName(file.name) && unzip);
  // Um arquivo vira uma amostra com titulo proprio; varios (ou o .zip
  // desmembrado) usam o nome de cada arquivo.
  const many = files.length > 1 || zipMode;
  const { allowNavigation } = useUnsavedChanges(
    Boolean(
      files.length || title || description || tags || url || urlTitle || urlDescription || urlTags,
    ) || Boolean(progress),
  );

  // Validacao no estilo HPSM (campo destacado + mensagem + foco).
  const fileCheck = useRequiredFields([
    {
      id: 'file-pick',
      label: tooBig.length
        ? tooBig.length > 1
          ? t('tooBigMany', { name: tooBig[0].name, n: tooBig.length - 1, max: maxUploadMb })
          : t('tooBigOne', { name: tooBig[0].name, max: maxUploadMb })
        : t('file'),
      ok: files.length > 0 && tooBig.length === 0,
    },
    { id: 'zip-password', label: t('zipPassword'), ok: true, api: 'password', value: zipPassword },
  ]);
  const urlCheck = useRequiredFields([
    {
      id: 'url',
      label: t('suspiciousUrl'),
      ok: /^https?:\/\/\S+\.\S+/i.test(url.trim()),
      value: url,
    },
    // So a API valida estes (tamanhos): o destaque vem do `details` do 400.
    { id: 'url-title', label: t('title'), ok: true, api: 'title', value: urlTitle },
    {
      id: 'url-description',
      label: t('description'),
      ok: true,
      api: 'description',
      value: urlDescription,
    },
    { id: 'url-tags', label: t('tags'), ok: true, api: 'tags', value: urlTags },
  ]);
  const validation = tab === 'file' ? fileCheck.message : urlCheck.message;

  /** Depois de um lote o formulario volta ao comeco (o resultado fica abaixo). */
  const resetFileForm = () => {
    fileCheck.reset();
    setFiles([]);
    setTitle('');
    setDescription('');
    setTags('');
    setUnzip(false);
  };

  const submitZip = async (zip: File) => {
    const form = new FormData();
    form.append('file', zip);
    form.append('password', zipPassword);
    if (description) form.append('description', description);
    if (tags) form.append('tags', tags);
    setProgress(t('sendingZip'));
    try {
      const res = await api.upload<ZipResult>('/entries/zip', form, (percent) =>
        setProgress(percent < 100 ? t('sendingZipPct', { percent }) : t('openingZip')),
      );
      setBatch({ source: zip.name, rows: zipRows(res) });
      resetFileForm();
    } catch (err) {
      if (fileCheck.fromApi(err)) return;
      const data = err instanceof ApiError ? (err.data as Partial<ZipResult> | null) : null;
      if (data?.skipped?.length) {
        setBatch({ source: zip.name, rows: zipRows({ created: [], skipped: data.skipped }) });
      }
      setError((err as Error).message);
    } finally {
      setProgress(null);
    }
  };

  const submitBatch = async (list: File[]) => {
    const rows: BatchRow[] = list.map((f, i) => ({
      key: `${i}:${f.name}`,
      name: f.name,
      size: f.size,
      status: 'waiting',
    }));
    const update = (i: number, patch: Partial<BatchRow>) =>
      setBatch((current) =>
        current
          ? { ...current, rows: current.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) }
          : current,
      );
    setBatch({ source: `${list.length} arquivos`, rows });
    const shared = { description, tags };
    resetFileForm();
    // Um por vez: o limite de tamanho do servidor vale para cada arquivo.
    for (let i = 0; i < list.length; i++) {
      setProgress(t('sendingNofM', { i: i + 1, total: list.length }));
      update(i, { status: 'sending' });
      try {
        const form = new FormData();
        form.append('file', list[i]);
        form.append('title', list[i].name);
        if (shared.description) form.append('description', shared.description);
        if (shared.tags) form.append('tags', shared.tags);
        const res = await api.upload<{ entry: Entry; previous: Previous }>(
          '/entries/file',
          form,
          (percent) =>
            setProgress(
              percent < 100
                ? t('sendingNofMPct', { i: i + 1, total: list.length, percent })
                : t('analyzingNofM', { i: i + 1, total: list.length }),
            ),
        );
        update(i, { status: 'done', entry: res.entry, previous: res.previous });
      } catch (err) {
        update(i, { status: 'error', reason: (err as Error).message });
      }
    }
    setProgress(null);
  };

  const submitFile = async () => {
    setError(null);
    if (!fileCheck.check()) return;
    if (many) {
      setLoading(true);
      setBatch(null);
      try {
        if (zipMode && file) await submitZip(file);
        else await submitBatch(files);
      } finally {
        setLoading(false);
        void quotaQuery.refetch();
      }
      return;
    }
    if (!file) return;
    setLoading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('title', title || file.name);
      if (description) form.append('description', description);
      if (tags) form.append('tags', tags);
      const res = await api.upload<{ entry: Entry }>('/entries/file', form, (percent) =>
        setProgress(percent < 100 ? t('sendingPct', { percent }) : t('analyzingFile')),
      );
      allowNavigation();
      navigate(`/entries/${res.entry.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setProgress(null);
      setLoading(false);
    }
  };

  const submitUrl = async () => {
    setError(null);
    if (!urlCheck.check()) return;
    setLoading(true);
    try {
      const res = await api.post<{ entry: Entry }>('/entries/url', {
        url,
        title: urlTitle || url,
        description: urlDescription || undefined,
        tags: urlTags || undefined,
      });
      allowNavigation();
      navigate(`/entries/${res.entry.id}`);
    } catch (err) {
      if (!urlCheck.fromApi(err)) setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  // Enter num campo de uma linha envia (item 135); na descricao, continua quebrando linha.
  const submitOnEnter = (event: KeyboardEvent<HTMLDivElement>) => {
    const field = event.target;
    if (event.key !== 'Enter' || !(field instanceof HTMLInputElement)) return;
    if (field.type === 'checkbox' || field.type === 'file' || loading || quotaFull) return;
    event.preventDefault();
    void (tab === 'file' ? submitFile() : submitUrl());
  };

  // Ctrl+S envia o formulario da aba atual.
  useSaveShortcut(tab === 'file' ? submitFile : submitUrl, !loading);

  return (
    <>
      <PageHeader title={t('pageTitle')} subtitle={t('pageSubtitle')} />

      <HpsmToolbar label={t('submitActions')}>
        <HpsmToolbarButton
          label={
            loading
              ? t('sending')
              : tab === 'url'
                ? t('sendLink')
                : zipMode
                  ? t('splitAndSend')
                  : files.length > 1
                    ? t('sendNFiles', { n: files.length })
                    : t('sendFile')
          }
          title={t('sendHint')}
          icon={IconAdd}
          disabled={loading || quotaFull}
          onClick={tab === 'file' ? submitFile : submitUrl}
        />
        <HpsmToolbarButton
          label={t('cancel')}
          icon={IconArrowLeft}
          disabled={loading}
          onClick={() => navigate(-1)}
        />
        {quota && !quotaFull && (
          <span className="hpsm-toolbar__info dl-quota">
            {t(quota.remaining === 1 ? 'quotaOne' : 'quotaMany', {
              n: quota.remaining,
              limit: quota.limit,
            })}
          </span>
        )}
        {loading && (
          <HpsmLoading
            className="hpsm-toolbar__loading"
            text={tab === 'url' ? t('registeringLink') : (progress ?? t('secureUpload'))}
          />
        )}
      </HpsmToolbar>

      {quotaFull && quota && (
        <HpsmMessage kind="warning">
          {t('quotaFull', {
            limit: quota.limit,
            time: quota.resetAt
              ? new Date(quota.resetAt).toLocaleTimeString(intlLocale(), {
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : '—',
          })}
        </HpsmMessage>
      )}
      {error && <HpsmMessage kind="error">{error}</HpsmMessage>}
      {validation && <HpsmMessage kind="error">{validation}</HpsmMessage>}
      {tab === 'file' && duplicate && !zipMode && (
        <HpsmMessage kind="warning">
          {t('alreadySubmitted')}{' '}
          <Link className="dl-link" to={`/entries/${duplicate.id}`}>
            {duplicate.title}
          </Link>{' '}
          {t('verdictParen')} <VerdictTag verdict={duplicate.verdict} />
          {t('stillCanSend')}
        </HpsmMessage>
      )}

      <HpsmTabs
        ariaLabel={t('sampleType')}
        active={tab}
        onChange={setTab}
        items={[
          { id: 'file', label: t('file') },
          { id: 'url', label: t('link') },
        ]}
      />

      <div className="hpsm-tabpanel" onKeyDown={submitOnEnter}>
        {tab === 'file' ? (
          <HpsmSection title={t('fileData')} className="dl-form-col">
            <HpsmForm>
              <HpsmField
                label={t('file')}
                required
                top
                help={
                  many
                    ? t('manyHelp')
                    : maxUploadMb
                      ? t('filesHelpMax', { n: MAX_FILES, max: maxUploadMb })
                      : t('filesHelp', { n: MAX_FILES })
                }
                invalid={fileCheck.isInvalid('file-pick')}
              >
                <HpsmFileDrop
                  files={files}
                  onChange={(next) => {
                    setFiles(next);
                    setError(null);
                  }}
                  multiple
                  maxFiles={MAX_FILES}
                  onLimit={(max) => setError(t('maxFilesIgnored', { max }))}
                  buttonId="file-pick"
                  invalid={fileCheck.isInvalid('file-pick')}
                />
              </HpsmField>
              {file && isZipName(file.name) && (
                <HpsmField label={t('zipPackage')} help={t('zipHelp')}>
                  <Checkbox
                    id="zip-unzip"
                    labelText={t('splitZip')}
                    checked={unzip}
                    onChange={(_, { checked }) => setUnzip(checked)}
                  />
                </HpsmField>
              )}
              {zipMode && (
                <HpsmField
                  label={t('zipPassword')}
                  htmlFor="zip-password"
                  invalid={fileCheck.isInvalid('zip-password')}
                  help={t('zipPasswordHelp')}
                >
                  <TextInput
                    id="zip-password"
                    labelText={t('zipPassword')}
                    hideLabel
                    autoComplete="off"
                    value={zipPassword}
                    onChange={(e) => setZipPassword(e.target.value)}
                  />
                </HpsmField>
              )}
              {file && !zipMode && (hashing || hash) && (
                <HpsmField label="SHA-256">
                  {hash ? (
                    <HpsmReadonly mono copyable={{ value: hash, label: 'SHA-256' }}>
                      {hash}
                    </HpsmReadonly>
                  ) : (
                    <HpsmLoading text={t('computingHash')} />
                  )}
                </HpsmField>
              )}
              {!many && (
                <HpsmField label={t('title')} htmlFor="file-title">
                  <TextInput
                    id="file-title"
                    labelText={t('title')}
                    hideLabel
                    placeholder={t('titlePlaceholderFile')}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </HpsmField>
              )}
              <HpsmField label={t('description')} htmlFor="file-description" top>
                <TextArea
                  id="file-description"
                  labelText={t('description')}
                  hideLabel
                  placeholder={t('descPlaceholderFile')}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                />
              </HpsmField>
              <HpsmField label={t('tags')} htmlFor="file-tags" help={t('tagsHelp')}>
                <TextInput
                  id="file-tags"
                  labelText={t('tags')}
                  hideLabel
                  placeholder="phishing, malware, ransomware"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                />
              </HpsmField>
            </HpsmForm>
          </HpsmSection>
        ) : (
          <HpsmSection title={t('linkData')} className="dl-form-col">
            <HpsmForm>
              <HpsmField
                label={t('suspiciousUrl')}
                htmlFor="url"
                required
                invalid={urlCheck.isInvalid('url')}
                help={t('urlHelp')}
              >
                <TextInput
                  id="url"
                  labelText={t('suspiciousUrl')}
                  hideLabel
                  placeholder="https://exemplo-suspeito.com/login"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
              </HpsmField>
              <HpsmField
                label={t('title')}
                htmlFor="url-title"
                invalid={urlCheck.isInvalid('url-title')}
              >
                <TextInput
                  id="url-title"
                  labelText={t('title')}
                  hideLabel
                  placeholder={t('titlePlaceholderUrl')}
                  value={urlTitle}
                  onChange={(e) => setUrlTitle(e.target.value)}
                />
              </HpsmField>
              <HpsmField
                label={t('description')}
                htmlFor="url-description"
                top
                invalid={urlCheck.isInvalid('url-description')}
              >
                <TextArea
                  id="url-description"
                  labelText={t('description')}
                  hideLabel
                  placeholder={t('descPlaceholderUrl')}
                  value={urlDescription}
                  onChange={(e) => setUrlDescription(e.target.value)}
                  rows={4}
                />
              </HpsmField>
              <HpsmField
                label={t('tags')}
                htmlFor="url-tags"
                help={t('tagsHelp')}
                invalid={urlCheck.isInvalid('url-tags')}
              >
                <TextInput
                  id="url-tags"
                  labelText={t('tags')}
                  hideLabel
                  placeholder="phishing, scam"
                  value={urlTags}
                  onChange={(e) => setUrlTags(e.target.value)}
                />
              </HpsmField>
            </HpsmForm>
          </HpsmSection>
        )}
      </div>

      {tab === 'file' && batch && <BatchResult rows={batch.rows} source={batch.source} />}
    </>
  );
}
