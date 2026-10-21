import './styles/app.scss';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';

import App from './App';
import { AuthProvider } from './auth/AuthContext';
import { ConfirmProvider } from './components/HpsmConfirm';

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
      <AuthProvider>
        <ConfirmProvider>
          <App />
        </ConfirmProvider>
      </AuthProvider>
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
