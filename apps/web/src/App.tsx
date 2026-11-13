import { Suspense, useEffect } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';

import { clearAfterLogin, peekAfterLogin, useAuth } from './auth/AuthContext';
import { startPath } from './auth/preferences';
import { useOwnSamplesOnly } from './auth/sampleAccess';
import { AppShell } from './components/AppShell';
import { lazyPage } from './components/lazyPage';
import { HpsmLoading } from './components/messages';
import { setLocale, useLocale } from './i18n';
import { t } from './i18n/shell';
import { ForcePasswordPage } from './pages/ForcePasswordPage';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';

// Paginas sob demanda (item 6.10): so a entrada (login, cadastro, pagina inicial e troca de
// senha forcada) fica no pacote principal; o resto e baixado quando a rota abre. O noVNC vem
// junto de SandboxConsoleWindowPage, a unica que o usa.
const AdminPage = lazyPage(() => import('./pages/AdminPage'), 'AdminPage');
const AllowlistPage = lazyPage(() => import('./pages/AllowlistPage'), 'AllowlistPage');
const ApiDocsPage = lazyPage(() => import('./pages/ApiDocsPage'), 'ApiDocsPage');
const AssignmentPage = lazyPage(() => import('./pages/AssignmentPage'), 'AssignmentPage');
const BroadcastsPage = lazyPage(() => import('./pages/BroadcastsPage'), 'BroadcastsPage');
const CasePage = lazyPage(() => import('./pages/CasePage'), 'CasePage');
const CasePrintPage = lazyPage(() => import('./pages/CasePrintPage'), 'CasePrintPage');
const CasesPage = lazyPage(() => import('./pages/CasesPage'), 'CasesPage');
const CompanyDomainsPage = lazyPage(
  () => import('./pages/CompanyDomainsPage'),
  'CompanyDomainsPage',
);
const ComparePage = lazyPage(() => import('./pages/ComparePage'), 'ComparePage');
const DashboardPage = lazyPage(() => import('./pages/DashboardPage'), 'DashboardPage');
const EntryDetailPage = lazyPage(() => import('./pages/EntryDetailPage'), 'EntryDetailPage');
const EntryPrintPage = lazyPage(() => import('./pages/EntryPrintPage'), 'EntryPrintPage');
const GlobalHistoryPage = lazyPage(() => import('./pages/GlobalHistoryPage'), 'GlobalHistoryPage');
const InboxPage = lazyPage(() => import('./pages/InboxPage'), 'InboxPage');
const IocPage = lazyPage(() => import('./pages/IocPage'), 'IocPage');
const KbArticlePage = lazyPage(() => import('./pages/KbArticlePage'), 'KbArticlePage');
const KbListPage = lazyPage(() => import('./pages/KbListPage'), 'KbListPage');
const ManagementPage = lazyPage(() => import('./pages/ManagementPage'), 'ManagementPage');
const ManagementPrintPage = lazyPage(
  () => import('./pages/ManagementPrintPage'),
  'ManagementPrintPage',
);
const MyUploadsPage = lazyPage(() => import('./pages/MyUploadsPage'), 'MyUploadsPage');
const ReviewQueuePage = lazyPage(() => import('./pages/ReviewQueuePage'), 'ReviewQueuePage');
const SandboxConsoleWindowPage = lazyPage(
  () => import('./pages/SandboxConsoleWindowPage'),
  'SandboxConsoleWindowPage',
);
const SearchPage = lazyPage(() => import('./pages/SearchPage'), 'SearchPage');
const SubmitPage = lazyPage(() => import('./pages/SubmitPage'), 'SubmitPage');
const TriageRulesPage = lazyPage(() => import('./pages/TriageRulesPage'), 'TriageRulesPage');
const UserPage = lazyPage(() => import('./pages/UserPage'), 'UserPage');
const WelcomePage = lazyPage(() => import('./pages/WelcomePage'), 'WelcomePage');
const YaraRulesPage = lazyPage(() => import('./pages/YaraRulesPage'), 'YaraRulesPage');

function FullScreenLoader() {
  return (
    <div className="dl-public">
      <div className="dl-public__main">
        <HpsmLoading text={t('loadingDeepLook')} />
      </div>
    </div>
  );
}

/** Raiz: destino pos-login (se houver) ou a pagina inicial escolhida nas preferencias. */
/** Restrito ao que enviou (item 140): o Historico Global vira Meus Uploads. */
function HistoryRoute() {
  return useOwnSamplesOnly() ? <Navigate to="/me" replace /> : <GlobalHistoryPage />;
}

function RootRedirect() {
  const { preferences } = useAuth();
  const target = peekAfterLogin();
  useEffect(() => clearAfterLogin(), []);
  return <Navigate to={target?.to ?? startPath(preferences)} state={target?.state} replace />;
}

/** Shell da aplicacao (topbar/sidebar/rodape) usado pelas rotas internas. */
function ShellLayout() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

export default function App() {
  const { user, loading } = useAuth();
  // A raiz assina o idioma (revisao 2.5): ao trocar, a arvore inteira se redesenha, inclusive o
  // que usa t() fora de componente (rotulos de status, veredito...).
  useLocale();
  // Logado, vale a preferencia da conta (a mesma em qualquer maquina).
  const language = user?.preferences.language;
  useEffect(() => {
    if (language) setLocale(language);
  }, [language]);

  if (loading) return <FullScreenLoader />;

  if (!user) {
    return (
      <Routes>
        <Route path="/home" element={<HomePage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/home" replace />} />
      </Routes>
    );
  }

  // Senha redefinida pelo admin: so a tela de nova senha ate trocar (a API recusa o resto).
  if (user.mustChangePassword) {
    return (
      <Routes>
        <Route path="*" element={<ForcePasswordPage />} />
      </Routes>
    );
  }

  // As paginas sao carregadas sob demanda (item 6.10). Dentro da casca quem espera e o
  // Suspense do AppShell (topo, navegador e abas ficam); este cobre as telas sem casca.
  return (
    <Suspense fallback={<FullScreenLoader />}>
      <Routes>
        {/* Janela dedicada do console do sandbox (aberta via window.open, sem o shell). */}
        <Route path="/sandbox/entry/:entryId/console" element={<SandboxConsoleWindowPage />} />
        {/* Ficha para impressao (menu "Mais" > Imprimir ficha), tambem sem o shell. */}
        <Route path="/entries/:id/imprimir" element={<EntryPrintPage />} />
        <Route path="/casos/:id/imprimir" element={<CasePrintPage />} />
        <Route path="/gerencial/imprimir" element={<ManagementPrintPage />} />

        <Route element={<ShellLayout />}>
          {/* Raiz (e destino apos o login): a pagina inicial escolhida nas preferencias. */}
          <Route path="/" element={<RootRedirect />} />
          <Route path="/inicio" element={<WelcomePage />} />
          <Route path="/user" element={<UserPage />} />
          {/* Documentacao da API (item 93). */}
          <Route path="/user/api" element={<ApiDocsPage />} />
          <Route path="/history" element={<HistoryRoute />} />
          <Route path="/me" element={<MyUploadsPage />} />
          <Route path="/submit" element={<SubmitPage />} />
          <Route path="/entries/:id" element={<EntryDetailPage />} />
          <Route path="/iocs/:kind/:value" element={<IocPage />} />
          <Route path="/inbox" element={<InboxPage />} />
          <Route
            path="/casos"
            element={user.role === 'USER' ? <Navigate to="/" replace /> : <CasesPage />}
          />
          <Route
            path="/casos/:id"
            element={user.role === 'USER' ? <Navigate to="/" replace /> : <CasePage />}
          />
          <Route path="/busca" element={<SearchPage />} />
          <Route path="/kb" element={<KbListPage />} />
          <Route path="/kb/novo" element={<KbArticlePage key="new" mode="new" />} />
          <Route path="/kb/:id" element={<KbArticlePage key="view" mode="view" />} />
          <Route path="/kb/:id/editar" element={<KbArticlePage key="edit" mode="edit" />} />
          <Route path="/painel" element={<DashboardPage />} />
          <Route
            path="/revisoes"
            element={user.role === 'USER' ? <Navigate to="/" replace /> : <ReviewQueuePage />}
          />
          <Route
            path="/comparar"
            element={user.role === 'USER' ? <Navigate to="/" replace /> : <ComparePage />}
          />
          <Route
            path="/permitidos"
            element={user.role === 'USER' ? <Navigate to="/" replace /> : <AllowlistPage />}
          />
          <Route
            path="/atribuicao"
            element={user.role === 'USER' ? <Navigate to="/" replace /> : <AssignmentPage />}
          />
          <Route
            path="/gerencial"
            element={user.role === 'USER' ? <Navigate to="/" replace /> : <ManagementPage />}
          />
          <Route
            path="/avisos"
            element={user.role === 'USER' ? <Navigate to="/" replace /> : <BroadcastsPage />}
          />
          <Route
            path="/dominios-empresa"
            element={user.role === 'USER' ? <Navigate to="/" replace /> : <CompanyDomainsPage />}
          />
          <Route
            path="/regras-triagem"
            element={user.role === 'USER' ? <Navigate to="/" replace /> : <TriageRulesPage />}
          />
          <Route
            path="/yara"
            element={user.role === 'USER' ? <Navigate to="/" replace /> : <YaraRulesPage />}
          />
          <Route
            path="/admin"
            element={user.role === 'ADMIN' ? <AdminPage /> : <Navigate to="/" replace />}
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
