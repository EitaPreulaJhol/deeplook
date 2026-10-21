import { TextArea, TextInput } from '@carbon/react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { api } from '../api/client';
import type { Entry } from '../api/types';
import { HpsmFileDrop } from '../components/HpsmFileDrop';
import { HpsmField, HpsmForm, HpsmReadonly, HpsmSection } from '../components/HpsmForm';
import { HpsmTabs } from '../components/HpsmTabs';
import { HpsmToolbar, HpsmToolbarButton } from '../components/HpsmToolbar';
import { IconAdd, IconArrowLeft } from '../components/icons';
import { HpsmLoading, HpsmMessage } from '../components/messages';
import { PageHeader } from '../components/PageHeader';
import { useSaveShortcut } from '../components/shortcuts';
import { VerdictTag } from '../components/tags';
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

export function SubmitPage() {
  const navigate = useNavigate();

  const [file, setFile] = useState<File | null>(null);
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
  const { allowNavigation } = useUnsavedChanges(
    Boolean(file || title || description || tags || url || urlTitle || urlDescription || urlTags),
  );

  const submitFile = async () => {
    setError(null);
    if (!file) {
      setError('Selecione um arquivo para enviar.');
      return;
    }
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
    if (!url) {
      setError('Informe uma URL.');
      return;
    }
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
      setError((err as Error).message);
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
          label={loading ? 'Enviando...' : tab === 'file' ? 'Enviar arquivo' : 'Enviar link'}
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
            text={tab === 'file' ? 'Fazendo upload seguro...' : 'Registrando link...'}
          />
        )}
      </HpsmToolbar>

      {error && <HpsmMessage kind="error">{error}</HpsmMessage>}
      {tab === 'file' && duplicate && (
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
                help="Tamanho máximo conforme configurado no servidor."
              >
                <HpsmFileDrop file={file} onChange={setFile} />
              </HpsmField>
              {file && (hashing || hash) && (
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
              <HpsmField label="URL suspeita" htmlFor="url" required>
                <TextInput
                  id="url"
                  labelText="URL suspeita"
                  hideLabel
                  placeholder="https://exemplo-suspeito.com/login"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
              </HpsmField>
              <HpsmField label="Título" htmlFor="url-title">
                <TextInput
                  id="url-title"
                  labelText="Título"
                  hideLabel
                  placeholder="Ex.: página de phishing falsa"
                  value={urlTitle}
                  onChange={(e) => setUrlTitle(e.target.value)}
                />
              </HpsmField>
              <HpsmField label="Descrição" htmlFor="url-description" top>
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
              <HpsmField label="Tags" htmlFor="url-tags" help="Separadas por vírgula.">
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
    </>
  );
}
