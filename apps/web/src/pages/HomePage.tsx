import { Button, Theme } from '@carbon/react';
import { useNavigate } from 'react-router-dom';

import { AppFooter } from '../components/AppFooter';

export function HomePage() {
  const navigate = useNavigate();

  return (
    <Theme theme="g100">
      <div className="dl-home">
        <header className="dl-home__topbar">
          <div className="dl-home__topbar-inner">
            <span className="dl-home__brand">
              <img src="/deeplook.svg" alt="" className="dl-logo" />
              DeepLook
            </span>
            <div className="dl-home__actions">
              <Button kind="ghost" size="xs" onClick={() => navigate('/login')}>
                Entrar
              </Button>
              <Button size="xs" onClick={() => navigate('/register')}>
                Criar conta
              </Button>
            </div>
          </div>
        </header>

        <main>
          <section className="dl-home__hero">
            <h1 className="dl-home__title">Olhe mais a fundo antes de confiar.</h1>
            <p className="dl-home__lead">
              O <strong>DeepLook</strong> é uma plataforma voltada para análise e verificação de
              executáveis inseguros e desconhecidos. Disponibilizamos ambientes de teste, ferramentas 
              e recursos para que você possa analisar arquivos suspeitos com segurança e compartilhar 
              suas descobertas com a comunidade.
            </p>
          </section>
        </main>
        <AppFooter />
      </div>
    </Theme>
  );
}
