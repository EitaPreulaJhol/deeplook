import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  TextInput,
} from '@carbon/react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { api } from '../api/client';
import type { EntryType, Verdict } from '../api/types';
import { useConfirm } from './HpsmConfirm';
import { formatFileSize } from './HpsmFileDrop';
import { HpsmFilterBar, HpsmFilterItem } from './HpsmFilterBar';
import { HpsmLoading, HpsmMessage } from './messages';
import { TypeTag, VerdictTag } from './tags';

const PAGE_SIZE = 50;

/** Amostra na lixeira (GET /api/admin/trash). */
interface TrashItem {
  id: string;
  title: string;
  type: EntryType;
  verdict: Verdict;
  sha256: string | null;
  url: string | null;
  fileSize: number | null;
  filePurgedAt: string | null;
  createdAt: string;
  deletedAt: string;
  owner: { id: string; displayName: string };
  deletedBy: { id: string; displayName: string } | null;
  _count: { reports: number };
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR');
}

/**
 * Aba "Lixeira" da Administracao: amostras escondidas de todas as telas. Daqui
 * elas voltam (Restaurar) ou somem de vez, com o arquivo no armazenamento
 * (Excluir definitivamente). As duas acoes entram na auditoria.
 */
export function AdminTrashTab() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const location = useLocation();
  const [draftQ, setDraftQ] = useState('');
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  // Vindo da ficha ("Mover para a lixeira"), o aviso aparece aqui.
  const trashed = (location.state as { trashed?: string } | null)?.trashed;
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(
    trashed ? { ok: true, text: `"${trashed}" foi movida para a lixeira.` } : null,
  );

  useEffect(() => {
    const id = window.setTimeout(() => {
      setQ(draftQ.trim());
      setOffset(0);
    }, 300);
    return () => window.clearTimeout(id);
  }, [draftQ]);

  const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
  if (q) params.set('q', q);
  const query = useQuery({
    queryKey: ['admin', 'trash', q, offset],
    queryFn: () => api.get<{ total: number; items: TrashItem[] }>(`/admin/trash?${params}`),
    placeholderData: keepPreviousData,
  });

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin', 'trash'] }),
      queryClient.invalidateQueries({ queryKey: ['entries'] }),
    ]);

  const restore = async (item: TrashItem) => {
    setBusy(item.id);
    setNotice(null);
    try {
      await api.post(`/admin/trash/${item.id}/restore`, {});
      await refresh();
      setNotice({ ok: true, text: `"${item.title}" foi restaurada e voltou às listas.` });
    } catch (err) {
      setNotice({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const remove = async (item: TrashItem) => {
    const ok = await confirm({
      title: 'Excluir definitivamente',
      message: `"${item.title}" será apagada com o arquivo, os relatórios, o histórico e as atualizações. Não há como desfazer.`,
      confirmLabel: 'Excluir',
      cancelLabel: 'Cancelar',
      danger: true,
    });
    if (!ok) return;
    setBusy(item.id);
    setNotice(null);
    try {
      await api.del(`/admin/trash/${item.id}`);
      await refresh();
      setNotice({ ok: true, text: `"${item.title}" foi excluída definitivamente.` });
    } catch (err) {
      setNotice({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const total = query.data?.total ?? 0;
  const items = query.data?.items ?? [];
  const first = total ? offset + 1 : 0;
  const last = Math.min(offset + PAGE_SIZE, total);

  return (
    <>
      {notice && (
        <HpsmMessage key={notice.text} kind={notice.ok ? 'success' : 'error'}>
          {notice.text}
        </HpsmMessage>
      )}
      <HpsmFilterBar
        onClear={() => {
          setDraftQ('');
          setQ('');
          setOffset(0);
        }}
      >
        <HpsmFilterItem label="Buscar" htmlFor="trash-q">
          <TextInput
            id="trash-q"
            labelText="Buscar"
            hideLabel
            size="sm"
            placeholder="Título, hash, URL..."
            value={draftQ}
            onChange={(e) => setDraftQ(e.target.value)}
          />
        </HpsmFilterItem>
      </HpsmFilterBar>

      {query.isLoading && <HpsmLoading text="Carregando a lixeira..." />}
      {query.isError && (
        <HpsmMessage kind="error">
          Erro ao carregar a lixeira: {(query.error as Error).message}
        </HpsmMessage>
      )}
      {query.data && total === 0 && (
        <HpsmMessage kind="info">
          {q ? 'Nenhuma amostra na lixeira com essa busca.' : 'A lixeira está vazia.'}
        </HpsmMessage>
      )}

      {query.data && total > 0 && (
        <>
          <TableContainer>
            <Table size="xs" aria-label="Lixeira">
              <TableHead>
                <TableRow>
                  <TableHeader scope="col">Amostra</TableHeader>
                  <TableHeader scope="col">Tipo</TableHeader>
                  <TableHeader scope="col">Veredito</TableHeader>
                  <TableHeader scope="col">Enviada por</TableHeader>
                  <TableHeader scope="col">Movida por</TableHeader>
                  <TableHeader scope="col">Na lixeira desde</TableHeader>
                  <TableHeader scope="col">Ações</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <strong>{item.title}</strong>
                      <span className="dl-trash__meta">
                        {item.type === 'FILE'
                          ? `${formatFileSize(item.fileSize)}${item.filePurgedAt ? ' · arquivo já expurgado' : ''}`
                          : item.url}
                        {item._count.reports > 0 &&
                          ` · ${item._count.reports} relatório${item._count.reports === 1 ? '' : 's'}`}
                      </span>
                    </TableCell>
                    <TableCell>
                      <TypeTag type={item.type} />
                    </TableCell>
                    <TableCell>
                      <VerdictTag verdict={item.verdict} />
                    </TableCell>
                    <TableCell>{item.owner.displayName}</TableCell>
                    <TableCell>{item.deletedBy?.displayName ?? '—'}</TableCell>
                    <TableCell className="dl-audit__date">{fmtDate(item.deletedAt)}</TableCell>
                    <TableCell>
                      <span className="dl-trash__actions">
                        <button
                          type="button"
                          className="dl-link-button"
                          disabled={busy !== null}
                          onClick={() => void restore(item)}
                        >
                          Restaurar
                        </button>
                        <button
                          type="button"
                          className="dl-link-button dl-link-button--danger"
                          disabled={busy !== null}
                          onClick={() => void remove(item)}
                        >
                          Excluir definitivamente…
                        </button>
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <div className="dl-table-foot">
            <span>
              Exibindo registros {first} a {last} de {total}
            </span>
            <div className="hpsm-pager" role="group" aria-label="Paginação">
              <button
                type="button"
                className="hpsm-pager__btn"
                title="Página anterior"
                aria-label="Página anterior"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                ‹ Anterior
              </button>
              <button
                type="button"
                className="hpsm-pager__btn"
                title="Próxima página"
                aria-label="Próxima página"
                disabled={last >= total}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                Próxima ›
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
