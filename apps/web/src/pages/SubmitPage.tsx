import {
  Button,
  FileUploader,
  InlineLoading,
  InlineNotification,
  Stack,
  TextArea,
  TextInput,
} from '@carbon/react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { api } from '../api/client';
import type { Entry } from '../api/types';
import { HpsmTabs } from '../components/HpsmTabs';
import { PageHeader } from '../components/PageHeader';

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
      navigate(`/entries/${res.entry.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Enviar Amostra"
        subtitle="Envie um arquivo suspeito ou um link para que os analistas possam investigar."
      />

      <InlineNotification
        kind="warning"
        lowContrast
        title="Cuidado com amostras maliciosas"
        subtitle="O DeepLook apenas armazena e organiza as amostras para triagem. Nada é executado aqui."
        className="dl-note dl-mb-lg"
      />

      {error && (
        <InlineNotification
          kind="error"
          title="Erro"
          subtitle={error}
          lowContrast
          className="dl-note dl-mb-lg"
        />
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
          <div className="dl-form-col dl-panel">
            <FileUploader
              labelTitle="Arquivo da amostra"
              labelDescription="Tamanho máximo conforme configurado no servidor."
              buttonLabel="Selecionar arquivo"
              filenameStatus="edit"
              iconDescription="Limpar"
              accept={['*']}
              multiple={false}
              onChange={(evt) => {
                const f = (evt.target as HTMLInputElement).files;
                setFile(f && f.length ? f[0] : null);
              }}
              onDelete={() => setFile(null)}
            />
            <div className="dl-mt-lg">
              <Stack gap={6}>
                <TextInput
                  id="file-title"
                  labelText="Título"
                  placeholder="Ex.: instalador_suspeito.exe"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
                <TextArea
                  id="file-description"
                  labelText="Descrição"
                  placeholder="Onde encontrou, o que chamou a atenção..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                />
                <TextInput
                  id="file-tags"
                  labelText="Tags (separadas por vírgula)"
                  placeholder="phishing, malware, ransomware"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                />
                <Button onClick={submitFile} disabled={loading}>
                  {loading ? 'Enviando...' : 'Enviar arquivo'}
                </Button>
                {loading && <InlineLoading description="Fazendo upload seguro..." />}
              </Stack>
            </div>
          </div>
        ) : (
          <div className="dl-form-col dl-panel">
            <Stack gap={6}>
              <TextInput
                id="url"
                labelText="URL suspeita"
                placeholder="https://exemplo-suspeito.com/login"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              <TextInput
                id="url-title"
                labelText="Título"
                placeholder="Ex.: página de phishing falsa"
                value={urlTitle}
                onChange={(e) => setUrlTitle(e.target.value)}
              />
              <TextArea
                id="url-description"
                labelText="Descrição"
                placeholder="Como chegou até esse link, contexto, remetente..."
                value={urlDescription}
                onChange={(e) => setUrlDescription(e.target.value)}
                rows={4}
              />
              <TextInput
                id="url-tags"
                labelText="Tags (separadas por vírgula)"
                placeholder="phishing, scam"
                value={urlTags}
                onChange={(e) => setUrlTags(e.target.value)}
              />
              <Button onClick={submitUrl} disabled={loading}>
                {loading ? 'Enviando...' : 'Enviar link'}
              </Button>
              {loading && <InlineLoading description="Registrando link..." />}
            </Stack>
          </div>
        )}
      </div>
    </>
  );
}
