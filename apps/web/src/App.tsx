import { InlineLoading, Theme } from '@carbon/react';
import { Navigate, Route, Routes } from 'react-router-dom';

import { useAuth } from './auth/AuthContext';
import { AppShell } from './components/AppShell';
import { AdminPage } from './pages/AdminPage';
import { EntryDetailPage } from './pages/EntryDetailPage';
import { GlobalHistoryPage } from './pages/GlobalHistoryPage';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { MyUploadsPage } from './pages/MyUploadsPage';
import { RegisterPage } from './pages/RegisterPage';
import { SubmitPage } from './pages/SubmitPage';

function FullScreenLoader() {
  return (
    <Theme theme="g100">
      <div className="dl-auth">
        <div className="dl-auth__main" style={{ alignItems: 'center' }}>
          <InlineLoading description="Carregando DeepLook..." />
        </div>
      </div>
    </Theme>
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

  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to="/history" replace />} />
        <Route path="/history" element={<GlobalHistoryPage />} />
        <Route path="/me" element={<MyUploadsPage />} />
        <Route path="/submit" element={<SubmitPage />} />
        <Route path="/entries/:id" element={<EntryDetailPage />} />
        <Route
          path="/admin"
          element={user.role === 'ADMIN' ? <AdminPage /> : <Navigate to="/history" replace />}
        />
        <Route path="*" element={<Navigate to="/history" replace />} />
      </Routes>
    </AppShell>
  );
}
