import { Link } from 'react-router-dom';

import { useAuth } from '../auth/AuthContext';
import { HpsmSection } from '../components/HpsmForm';
import { PageHeader } from '../components/PageHeader';

/** Pagina inicial do app logado: texto introdutorio de boas-vindas. */
export function WelcomePage() {
  const { user } = useAuth();
  const canTriage = user?.role === 'ANALYST' || user?.role === 'ADMIN';

  return (
    <>
      <PageHeader
        title="Página Inicial"
        subtitle={user ? `Bem-vindo(a), ${user.displayName}.` : undefined}
      />

      <div className="dl-welcome">
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
              Atenção: as amostras podem ser maliciosas. Baixe e execute arquivos apenas em ambiente
              isolado.
            </li>
          </ul>
        </HpsmSection>
      </div>
    </>
  );
}
