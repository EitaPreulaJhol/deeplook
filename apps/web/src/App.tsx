import { Navigate, Outlet, Route, Routes } from 'react-router-dom';

import { useAuth } from './auth/AuthContext';
import { startPath } from './auth/preferences';
import { AppShell } from './components/AppShell';
import { HpsmLoading } from './components/messages';
import { AdminPage } from './pages/AdminPage';
import { EntryDetailPage } from './pages/EntryDetailPage';
import { EntryPrintPage } from './pages/EntryPrintPage';
import { GlobalHistoryPage } from './pages/GlobalHistoryPage';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { MyUploadsPage } from './pages/MyUploadsPage';
import { RegisterPage } from './pages/RegisterPage';
import { SandboxConsoleWindowPage } from './pages/SandboxConsoleWindowPage';
import { SubmitPage } from './pages/SubmitPage';
import { UserPage } from './pages/UserPage';
import { WelcomePage } from './pages/WelcomePage';

function FullScreenLoader() {
  return (
    <div className="dl-public">
      <div className="dl-public__main">
        <HpsmLoading text="Carregando DeepLook..." />
      </div>
    </div>
  );
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
  const { user, preferences, loading } = useAuth();

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

  return (
    <Routes>
      {/* Janela dedicada do console do sandbox (aberta via window.open, sem o shell). */}
      <Route path="/sandbox/entry/:entryId/console" element={<SandboxConsoleWindowPage />} />
      {/* Ficha para impressao (menu "Mais" > Imprimir ficha), tambem sem o shell. */}
      <Route path="/entries/:id/imprimir" element={<EntryPrintPage />} />

      <Route element={<ShellLayout />}>
        {/* Raiz (e destino apos o login): a pagina inicial escolhida nas preferencias. */}
        <Route path="/" element={<Navigate to={startPath(preferences)} replace />} />
        <Route path="/inicio" element={<WelcomePage />} />
        <Route path="/user" element={<UserPage />} />
        <Route path="/history" element={<GlobalHistoryPage />} />
        <Route path="/me" element={<MyUploadsPage />} />
        <Route path="/submit" element={<SubmitPage />} />
        <Route path="/entries/:id" element={<EntryDetailPage />} />
        <Route
          path="/admin"
          element={user.role === 'ADMIN' ? <AdminPage /> : <Navigate to="/" replace />}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
