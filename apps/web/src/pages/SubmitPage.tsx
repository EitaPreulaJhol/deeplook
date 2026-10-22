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

const ROW_STATUS: Record<BatchRow['status'], { label: string; tone: StatusTone }> = {
  waiting: { label: 'Aguardando', tone: 'gray' },
  sending: { label: 'Enviando...', tone: 'blue' },
  done: { label: 'Enviada', tone: 'green' },
  skipped: { label: 'Ignorado', tone: 'orange' },
  error: { label: 'Falha', tone: 'red' },
};

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
    <HpsmSection title={`Resultado do envio — ${source}`}>
      {!running &&
        (failed === 0 ? (
          <HpsmMessage kind="success">
            {done === 1 ? '1 amostra criada.' : `${done} amostras criadas.`}
          </HpsmMessage>
        ) : (
          <HpsmMessage kind={done ? 'warning' : 'error'}>
            {done === 1 ? '1 amostra criada' : `${done} amostras criadas`};{' '}
            {failed === 1 ? '1 arquivo não foi enviado' : `${failed} arquivos não foram enviados`}.
            Veja o motivo de cada um abaixo.
          </HpsmMessage>
        ))}
      <TableContainer>
        <Table size="xs" aria-label="Resultado do envio">
          <TableHead>
            <TableRow>
              <TableHeader scope="col">Arquivo</TableHeader>
              <TableHeader scope="col">Tamanho</TableHeader>
              <TableHeader scope="col">Situação</TableHeader>
              <TableHeader scope="col">Amostra</TableHeader>
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
                          · já enviada antes:{' '}
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
    { id: 'file-pick', label: 'Arquivo', ok: files.length > 0 },
    { id: 'zip-password', label: 'Senha do .zip', ok: true, api: 'password', value: zipPassword },
  ]);
  const urlCheck = useRequiredFields([
    {
      id: 'url',
      label: 'URL suspeita',
      ok: /^https?:\/\/\S+\.\S+/i.test(url.trim()),
      value: url,
    },
    // So a API valida estes (tamanhos): o destaque vem do `details` do 400.
    { id: 'url-title', label: 'Título', ok: true, api: 'title', value: urlTitle },
    {
      id: 'url-description',
      label: 'Descrição',
      ok: true,
      api: 'description',
      value: urlDescription,
    },
    { id: 'url-tags', label: 'Tags', ok: true, api: 'tags', value: urlTags },
  ]);
  const validation = tab === 'file' ? fileCheck.message : urlCheck.message;

  /** Depois de um lote o formulario volta ao comeco (o resultado fica abaixo). */
  const resetFileForm = () => {
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
    setProgress('Abrindo o .zip e criando as amostras...');
    try {
      const res = await api.post<ZipResult>('/entries/zip', form);
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
      setProgress(`Enviando ${i + 1} de ${list.length}...`);
      update(i, { status: 'sending' });
      try {
        const form = new FormData();
        form.append('file', list[i]);
        form.append('title', list[i].name);
        if (shared.description) form.append('description', shared.description);
        if (shared.tags) form.append('tags', shared.tags);
        const res = await api.post<{ entry: Entry; previous: Previous }>('/entries/file', form);
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
      const res = await api.post<{ entry: Entry }>('/entries/file', form);
      allowNavigation();
      navigate(`/entries/${res.entry.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
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

  // Ctrl+S envia o formulario da aba atual.
  useSaveShortcut(tab === 'file' ? submitFile : submitUrl, !loading);

  return (
    <>
      <PageHeader
        title="Enviar Amostra"
        subtitle="Envie um arquivo suspeito ou um link para que os analistas possam investigar."
      />

      <HpsmToolbar label="Ações do envio">
        <HpsmToolbarButton
          label={
            loading
              ? 'Enviando...'
              : tab === 'url'
                ? 'Enviar link'
                : zipMode
                  ? 'Desmembrar e enviar'
                  : files.length > 1
                    ? `Enviar ${files.length} arquivos`
                    : 'Enviar arquivo'
          }
          title="Enviar (Ctrl+S)"
          icon={IconAdd}
          disabled={loading}
          onClick={tab === 'file' ? submitFile : submitUrl}
        />
        <HpsmToolbarButton
          label="Cancelar"
          icon={IconArrowLeft}
          disabled={loading}
          onClick={() => navigate(-1)}
        />
        {loading && (
          <HpsmLoading
            className="hpsm-toolbar__loading"
            text={tab === 'url' ? 'Registrando link...' : (progress ?? 'Fazendo upload seguro...')}
          />
        )}
      </HpsmToolbar>

      {error && <HpsmMessage kind="error">{error}</HpsmMessage>}
      {validation && <HpsmMessage kind="error">{validation}</HpsmMessage>}
      {tab === 'file' && duplicate && !zipMode && (
        <HpsmMessage kind="warning">
          Esta amostra já foi enviada:{' '}
          <Link className="dl-link" to={`/entries/${duplicate.id}`}>
            {duplicate.title}
          </Link>{' '}
          (veredito: <VerdictTag verdict={duplicate.verdict} />
          ). Você ainda pode enviá-la com um novo contexto.
        </HpsmMessage>
      )}

      <HpsmTabs
        ariaLabel="Tipo de amostra"
        active={tab}
        onChange={setTab}
        items={[
          { id: 'file', label: 'Arquivo' },
          { id: 'url', label: 'Link' },
        ]}
      />

      <div className="hpsm-tabpanel">
        {tab === 'file' ? (
          <HpsmSection title="Dados do arquivo" className="dl-form-col">
            <HpsmForm>
              <HpsmField
                label="Arquivo"
                required
                top
                help={
                  many
                    ? 'Cada arquivo vira uma amostra com o próprio nome; descrição e tags valem para todas.'
                    : `Um ou mais arquivos (até ${MAX_FILES}). Tamanho máximo por arquivo conforme configurado no servidor.`
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
                  onLimit={(max) =>
                    setError(
                      `Selecione no máximo ${max} arquivos por envio; os excedentes foram ignorados.`,
                    )
                  }
                  buttonId="file-pick"
                  invalid={fileCheck.isInvalid('file-pick')}
                />
              </HpsmField>
              {file && isZipName(file.name) && (
                <HpsmField
                  label="Pacote .zip"
                  help="O .zip é aberto só no servidor, sem executar nada. Até 20 arquivos por pacote."
                >
                  <Checkbox
                    id="zip-unzip"
                    labelText="Desmembrar: cada arquivo de dentro do .zip vira uma amostra"
                    checked={unzip}
                    onChange={(_, { checked }) => setUnzip(checked)}
                  />
                </HpsmField>
              )}
              {zipMode && (
                <HpsmField
                  label="Senha do .zip"
                  htmlFor="zip-password"
                  invalid={fileCheck.isInvalid('zip-password')}
                  help="Pacotes de malware costumam usar “infected”. Deixe em branco se não houver senha."
                >
                  <TextInput
                    id="zip-password"
                    labelText="Senha do .zip"
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
                    <HpsmLoading text="Calculando o hash do arquivo..." />
                  )}
                </HpsmField>
              )}
              {!many && (
                <HpsmField label="Título" htmlFor="file-title">
                  <TextInput
                    id="file-title"
                    labelText="Título"
                    hideLabel
                    placeholder="Ex.: instalador_suspeito.exe"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </HpsmField>
              )}
              <HpsmField label="Descrição" htmlFor="file-description" top>
                <TextArea
                  id="file-description"
                  labelText="Descrição"
                  hideLabel
                  placeholder="Onde encontrou, o que chamou a atenção..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                />
              </HpsmField>
              <HpsmField label="Tags" htmlFor="file-tags" help="Separadas por vírgula.">
                <TextInput
                  id="file-tags"
                  labelText="Tags"
                  hideLabel
                  placeholder="phishing, malware, ransomware"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                />
              </HpsmField>
            </HpsmForm>
          </HpsmSection>
        ) : (
          <HpsmSection title="Dados do link" className="dl-form-col">
            <HpsmForm>
              <HpsmField
                label="URL suspeita"
                htmlFor="url"
                required
                invalid={urlCheck.isInvalid('url')}
                help="Endereço completo, com http:// ou https://."
              >
                <TextInput
                  id="url"
                  labelText="URL suspeita"
                  hideLabel
                  placeholder="https://exemplo-suspeito.com/login"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
              </HpsmField>
              <HpsmField
                label="Título"
                htmlFor="url-title"
                invalid={urlCheck.isInvalid('url-title')}
              >
                <TextInput
                  id="url-title"
                  labelText="Título"
                  hideLabel
                  placeholder="Ex.: página de phishing falsa"
                  value={urlTitle}
                  onChange={(e) => setUrlTitle(e.target.value)}
                />
              </HpsmField>
              <HpsmField
                label="Descrição"
                htmlFor="url-description"
                top
                invalid={urlCheck.isInvalid('url-description')}
              >
                <TextArea
                  id="url-description"
                  labelText="Descrição"
                  hideLabel
                  placeholder="Como chegou até esse link, contexto, remetente..."
                  value={urlDescription}
                  onChange={(e) => setUrlDescription(e.target.value)}
                  rows={4}
                />
              </HpsmField>
              <HpsmField
                label="Tags"
                htmlFor="url-tags"
                help="Separadas por vírgula."
                invalid={urlCheck.isInvalid('url-tags')}
              >
                <TextInput
                  id="url-tags"
                  labelText="Tags"
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
