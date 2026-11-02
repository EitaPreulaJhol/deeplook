import './styles/app.scss';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';

import App from './App';
import { AuthProvider } from './auth/AuthContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ConfirmProvider } from './components/HpsmConfirm';
import { SessionWatcher } from './components/SessionWatcher';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

// Data router com uma unica rota "*": as <Routes> do App continuam iguais, mas
// passam a valer recursos como o useBlocker (aviso de alteracoes nao salvas).
const router = createBrowserRouter([
  {
    path: '*',
    element: (
      // Rede de seguranca por fora dos provedores (item 1.1): sem ela, uma
      // excecao no render deixa a tela em branco, sem mensagem nem saida.
      <ErrorBoundary variant="app">
        <AuthProvider>
          <ConfirmProvider>
            {/* Sessao por inatividade: renova com atividade, avisa 2 min antes. */}
            <SessionWatcher />
            <App />
          </ConfirmProvider>
        </AuthProvider>
      </ErrorBoundary>
    ),
  },
]);

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>,
);
