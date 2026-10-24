import { useEffect } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';

import { clearAfterLogin, peekAfterLogin, useAuth } from './auth/AuthContext';
import { startPath } from './auth/preferences';
import { AppShell } from './components/AppShell';
import { HpsmLoading } from './components/messages';
import { AdminPage } from './pages/AdminPage';
import { AllowlistPage } from './pages/AllowlistPage';
import { CasePage } from './pages/CasePage';
import { CasePrintPage } from './pages/CasePrintPage';
import { CasesPage } from './pages/CasesPage';
import { ComparePage } from './pages/ComparePage';
import { DashboardPage } from './pages/DashboardPage';
import { EntryDetailPage } from './pages/EntryDetailPage';
import { EntryPrintPage } from './pages/EntryPrintPage';
import { ForcePasswordPage } from './pages/ForcePasswordPage';
import { GlobalHistoryPage } from './pages/GlobalHistoryPage';
import { HomePage } from './pages/HomePage';
import { InboxPage } from './pages/InboxPage';
import { IocPage } from './pages/IocPage';
import { KbArticlePage } from './pages/KbArticlePage';
import { KbListPage } from './pages/KbListPage';
import { LoginPage } from './pages/LoginPage';
import { MyUploadsPage } from './pages/MyUploadsPage';
import { RegisterPage } from './pages/RegisterPage';
import { ReviewQueuePage } from './pages/ReviewQueuePage';
import { SandboxConsoleWindowPage } from './pages/SandboxConsoleWindowPage';
import { SearchPage } from './pages/SearchPage';
import { SubmitPage } from './pages/SubmitPage';
import { UserPage } from './pages/UserPage';
import { WelcomePage } from './pages/WelcomePage';
import { YaraRulesPage } from './pages/YaraRulesPage';

function FullScreenLoader() {
  return (
    <div className="dl-public">
      <div className="dl-public__main">
        <HpsmLoading text="Carregando DeepLook..." />
      </div>
    </div>
  );
}

/** Raiz: destino pos-login (se houver) ou a pagina inicial escolhida nas preferencias. */
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

  return (
    <Routes>
      {/* Janela dedicada do console do sandbox (aberta via window.open, sem o shell). */}
      <Route path="/sandbox/entry/:entryId/console" element={<SandboxConsoleWindowPage />} />
      {/* Ficha para impressao (menu "Mais" > Imprimir ficha), tambem sem o shell. */}
      <Route path="/entries/:id/imprimir" element={<EntryPrintPage />} />
      <Route path="/casos/:id/imprimir" element={<CasePrintPage />} />

      <Route element={<ShellLayout />}>
        {/* Raiz (e destino apos o login): a pagina inicial escolhida nas preferencias. */}
        <Route path="/" element={<RootRedirect />} />
        <Route path="/inicio" element={<WelcomePage />} />
        <Route path="/user" element={<UserPage />} />
        <Route path="/history" element={<GlobalHistoryPage />} />
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
        <Route path="/revisoes" element={<ReviewQueuePage />} />
        <Route
          path="/comparar"
          element={user.role === 'USER' ? <Navigate to="/" replace /> : <ComparePage />}
        />
        <Route
          path="/permitidos"
          element={user.role === 'USER' ? <Navigate to="/" replace /> : <AllowlistPage />}
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
  );
}
