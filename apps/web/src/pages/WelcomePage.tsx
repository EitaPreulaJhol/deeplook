import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from '@carbon/react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { api } from '../api/client';
import type { Verdict } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { HpsmSection } from '../components/HpsmForm';
import { HpsmMessage } from '../components/messages';
import { PageHeader } from '../components/PageHeader';
import { VerdictTag } from '../components/tags';

interface Updates {
  since: string | null;
  completed: { entryId: string; title: string; verdict: Verdict; completedAt: string }[];
}

/** Pagina inicial do app logado: texto introdutorio de boas-vindas. */
export function WelcomePage() {
  const { user } = useAuth();
  const canTriage = user?.role === 'ANALYST' || user?.role === 'ADMIN';

  // Amostras do usuario concluidas desde a visita anterior.
  const updatesQuery = useQuery({
    queryKey: ['me', 'updates'],
    queryFn: () => api.get<Updates>('/me/updates'),
  });
  const completed = updatesQuery.data?.completed ?? [];

  return (
    <>
      <PageHeader
        title="Página Inicial"
        subtitle={user ? `Bem-vindo(a), ${user.displayName}.` : undefined}
      />

      {completed.length > 0 && (
        <HpsmMessage kind="info">
          {completed.length === 1
            ? '1 amostra sua foi concluída desde a sua última visita.'
            : `${completed.length} amostras suas foram concluídas desde a sua última visita.`}
        </HpsmMessage>
      )}

      <div className="dl-welcome">
        {completed.length > 0 && (
          <HpsmSection title="Novidades desde a sua última visita">
            <TableContainer>
              <Table size="xs" aria-label="Amostras concluídas desde a última visita">
                <TableHead>
                  <TableRow>
                    <TableHeader scope="col">Amostra</TableHeader>
                    <TableHeader scope="col">Veredito</TableHeader>
                    <TableHeader scope="col">Concluída em</TableHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {completed.map((item) => (
                    <TableRow key={item.entryId}>
                      <TableCell>
                        <Link className="dl-link" to={`/entries/${item.entryId}`}>
                          {item.title}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <VerdictTag verdict={item.verdict} />
                      </TableCell>
                      <TableCell>{new Date(item.completedAt).toLocaleString('pt-BR')}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </HpsmSection>
        )}

        <HpsmSection title="Bem-vindo ao DeepLook">
          <p>
            O <strong>DeepLook</strong> é uma plataforma colaborativa para análise e verificação de
            executáveis e links suspeitos. Aqui você envia amostras, acompanha a triagem feita pelos
            analistas e consulta os relatórios publicados pela comunidade, tudo antes de confiar em
            um arquivo desconhecido.
          </p>
        </HpsmSection>

        <HpsmSection title="Por onde começar">
          <ul>
            <li>
              <Link className="dl-link" to="/submit">
                Enviar Amostra
              </Link>{' '}
              — envie um arquivo ou link suspeito para que os analistas investiguem.
            </li>
            <li>
              <Link className="dl-link" to="/me">
                Meus Uploads
              </Link>{' '}
              — acompanhe o status e o veredito das amostras que você enviou.
            </li>
            <li>
              <Link className="dl-link" to="/history">
                Histórico Global
              </Link>{' '}
              — consulte todas as amostras da comunidade e os relatórios publicados.
            </li>
            {canTriage && (
              <li>
                Na aba <strong>Análise</strong> de cada amostra você faz a triagem e pode abrir um
                ambiente isolado para examinar o arquivo com segurança.
              </li>
            )}
          </ul>
        </HpsmSection>

        <HpsmSection title="Dicas">
          <ul>
            <li>
              Use o <strong>Navegador do Sistema</strong>, à esquerda, para trocar de tela. Cada
              tela ou amostra aberta vira uma aba no topo da área de trabalho.
            </li>
            <li>
              Clique no seu nome, no canto superior direito, e escolha{' '}
              <Link className="dl-link" to="/user">
                Minha conta
              </Link>{' '}
              para trocar a senha e ajustar suas preferências, inclusive qual tela abre ao entrar.
            </li>
            <li>
              Atalhos: <kbd>/</kbd> busca na lista, <kbd>Alt</kbd>+<kbd>N</kbd> enviar amostra,{' '}
              <kbd>Alt</kbd>+<kbd>W</kbd> fechar a aba atual, <kbd>Ctrl</kbd>+<kbd>S</kbd> salvar o
              formulário aberto e, na lista, <kbd>↑</kbd>/<kbd>↓</kbd> + <kbd>Enter</kbd> para abrir
              uma amostra.
            </li>
            <li>
              Atenção: as amostras podem ser maliciosas. Baixe e execute arquivos apenas em ambiente
              isolado.
            </li>
          </ul>
        </HpsmSection>
      </div>
    </>
  );
}
