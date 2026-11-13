import { useNavigate } from 'react-router-dom';

import { PublicLegal, PublicMasthead } from '../components/AuthLayout';
import { t } from '../i18n/shell';

export function HomePage() {
  const navigate = useNavigate();

  return (
    <div className="dl-public">
      <PublicMasthead />

      <main className="dl-public__main">
        <section className="dl-box dl-home" aria-labelledby="dl-home-title">
          <h1 id="dl-home-title" className="dl-box__head">
            {t('homeWelcome')}
          </h1>
          <div className="dl-box__body">
            <p className="dl-home__tagline">{t('tagline')}</p>
            <p className="dl-home__lead">
              {t('homeIntro').split('{brand}')[0]}
              <strong>DeepLook</strong>
              {t('homeIntro').split('{brand}')[1]}
            </p>
            <div className="dl-home__actions">
              <button
                type="button"
                className="dl-btn dl-btn--primary"
                onClick={() => navigate('/login')}
              >
                {t('signIn')}
              </button>
              <button type="button" className="dl-btn" onClick={() => navigate('/register')}>
                {t('createAccount')}
              </button>
            </div>
          </div>
        </section>
      </main>

      <PublicLegal />
    </div>
  );
}
