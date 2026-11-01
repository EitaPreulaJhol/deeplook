import { useNavigate } from 'react-router-dom';

import { PublicLegal, PublicMasthead } from '../components/AuthLayout';

export function HomePage() {
  const navigate = useNavigate();

  return (
    <div className="dl-public">
      <PublicMasthead />

      <main className="dl-public__main">
        <section className="dl-box dl-home" aria-labelledby="dl-home-title">
          <h1 id="dl-home-title" className="dl-box__head">
            Bem-vindo ao DeepLook
          </h1>
          <div className="dl-box__body">
            <p className="dl-home__tagline">Olhe mais a fundo antes de confiar.</p>
            <p className="dl-home__lead">
              O <strong>DeepLook</strong> é uma plataforma voltada para análise e verificação de
              executáveis inseguros e desconhecidos. Disponibilizamos ambientes de teste,
              ferramentas e recursos para que você possa analisar arquivos suspeitos com segurança e
              compartilhar suas descobertas com a equipe.
            </p>
            <div className="dl-home__actions">
              <button
                type="button"
                className="dl-btn dl-btn--primary"
                onClick={() => navigate('/login')}
              >
                Entrar
              </button>
              <button type="button" className="dl-btn" onClick={() => navigate('/register')}>
                Criar conta
              </button>
            </div>
          </div>
        </section>
      </main>

      <PublicLegal />
    </div>
  );
}
