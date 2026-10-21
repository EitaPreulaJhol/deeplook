# 🧭 Backlog de UX e usabilidade

Ideias levantadas depois da reformulação visual no estilo HP Service Manager 9
(ver [`docs/interface-hpsm.md`](interface-hpsm.md)). Todas seguem o mesmo princípio:
**melhorar o uso sem modernizar o visual** — os padrões citados (diálogo de
confirmação, filas com contadores, aba de atividades, Anterior/Próximo) existem no
próprio HPSM.

**Legenda** — Prioridade: 🔴 alta · 🟡 média · ⚪ baixa. Esforço: **P** (horas),
**M** (1–2 dias), **G** (vários dias, envolve banco).

## Resumo

| # | Ideia | Prioridade | Esforço | Área |
|---|---|---|---|---|
| 1 | Redefinição de senha pelo admin | 🔴 | P–M | Admin / API |
| 2 | Confirmação ao salvar a triagem | 🔴 | P | Amostra |
| 3 | Diálogo de confirmação em ações destrutivas | 🔴 | M | Admin / Sandbox |
| 4 | Aviso de alterações não salvas | 🔴 | M | Formulários |
| 5 | Filtros, ordenação e página na URL | 🔴 | P–M | Listas |
| 6 | "Minha fila" com contadores no navegador | 🟡 | M | Navegador / API |
| 7 | Atribuição de amostra a um analista | 🟡 | G | Amostra / banco |
| 8 | Aba "Histórico" (auditoria) na amostra | 🟡 | G | Amostra / banco |
| 9 | Anterior / Próximo na ficha da amostra | 🟡 | M | Amostra |
| 10 | Detecção de duplicata pelo SHA-256 | 🟡 | M | Envio / API |
| 11 | Arrastar e soltar o arquivo | ⚪ | P | Envio |
| 12 | Botões de copiar (hash, URL, IOCs) | ⚪ | P | Amostra / Relatórios |
| 13 | Avisos ao entrar ("suas amostras concluídas") | ⚪ | M | Página Inicial / API |
| 14 | Prazo do sandbox à vista | ⚪ | P–M | Sandbox |
| 15 | Atalhos de teclado | ⚪ | P | Global |
| 16 | Linhas da grade navegáveis pelo teclado | ⚪ | P | Listas |
| 17 | Exportar CSV da lista filtrada | ⚪ | M | Listas / API |
| 18 | Limite de tentativas no login e na troca de senha | 🔴 | P | Segurança / API |

**Ordem sugerida:** 1 → 2 → 3 → 18 → 5 → 10. A 1 cumpre o que a própria tela de
login promete; 2, 3 e 18 são pequenas e de alto impacto; 5 elimina a perda de filtros
ao trocar de aba; 10 é a de maior valor para quem envia amostras.

---

## 🔴 Alta prioridade

### 1. Redefinição de senha pelo admin
- **Problema:** o login diz "Peça a um administrador para redefinir a sua senha", mas
  o Admin não tem essa ação.
- **Proposta:** botão **Redefinir senha** na linha do usuário (Admin › Usuários) que
  gera uma senha temporária, mostra-a uma única vez na barra de mensagens (como a
  chave de ativação criada) e encerra as sessões do usuário. Opcional: obrigar a
  troca no próximo login.
- **Onde mexer:** `apps/api/src/routes/admin.ts` (novo
  `POST /api/admin/users/:id/reset-password`, reaproveitando `hashPassword` e o
  `session.deleteMany` de `routes/me.ts`); `apps/web/src/pages/AdminPage.tsx`.
- **Cuidados:** ação destrutiva → usar o diálogo da ideia 3; não registrar a senha
  em log.

### 2. Confirmação ao salvar a triagem
- **Problema:** em Amostra › Análise, mudar Status ou Veredito grava na hora, sem
  retorno — o usuário fica sem saber se salvou.
- **Proposta:** após o `PATCH`, mostrar `HpsmMessage kind="success"` "Registro
  atualizado." na barra de mensagens (padrão do HPSM).
- **Onde mexer:** `quickUpdate` em `apps/web/src/pages/EntryDetailPage.tsx`.

### 3. Diálogo de confirmação em ações destrutivas
- **Problema:** Revogar chave, Suspender usuário e Descartar VM executam com um
  clique.
- **Proposta:** componente `HpsmConfirm` no estilo HPSM (caixa com cabeçalho em
  gradiente, ícone de aviso, botões cinza **Sim** / **Não**, Esc = Não, foco inicial
  em Não) e um hook `useConfirm()` que devolve uma `Promise<boolean>`.
- **Onde mexer:** novo `components/HpsmConfirm.tsx`; usos em `AdminPage.tsx`,
  `SandboxPanel.tsx` e `SandboxConsoleWindowPage.tsx`.

### 4. Aviso de alterações não salvas
- **Problema:** fechar a aba de documento ou navegar no meio de um relatório ou
  envio perde o que foi digitado.
- **Proposta:** hook `useUnsavedChanges(dirty)` que (a) pergunta "Salvar as
  alterações?" ao fechar a aba de documento, (b) ativa o `beforeunload` do navegador.
- **Onde mexer:** `components/workspace.tsx` (o `close` consulta as abas "sujas"),
  `SubmitPage.tsx`, `EntryReportsTab.tsx` e `UserPage.tsx`.
- **Cuidados:** o app usa `<BrowserRouter>`/`<Routes>`; o `useBlocker` do React Router
  exige um *data router*. Começar pelo fechamento de aba e pelo `beforeunload`, ou
  migrar para `createBrowserRouter`.

### 5. Filtros, ordenação e página na URL
- **Problema:** ao trocar de aba de documento a página é recriada e perde busca,
  filtros, ordenação e página.
- **Proposta:** guardar `q`, `type`, `status`, `verdict`, `sort`, `dir` e `offset` em
  `?query` (o `workspace.tsx` já reabre cada aba na última URL). De quebra, o link de
  uma busca pode ser compartilhado.
- **Onde mexer:** `GlobalHistoryPage.tsx` e `MyUploadsPage.tsx` (trocar os `useState`
  por `useSearchParams`, mantendo o *debounce* da busca).

### 18. Limite de tentativas no login e na troca de senha
- **Problema:** não há limite de tentativas em `/api/auth/login` nem em
  `/api/me/password`.
- **Proposta:** `@fastify/rate-limit` nessas rotas (ex.: 5 tentativas / 5 min por IP +
  e-mail) com a mensagem "Muitas tentativas. Tente novamente em alguns minutos."
- **Onde mexer:** `apps/api/src/index.ts`, `routes/auth.ts`, `routes/me.ts`.
- **Cuidados:** atrás do Cloudflare Tunnel, configurar `trustProxy` para pegar o IP
  real.

---

## 🟡 Fluxo de trabalho dos analistas

### 6. "Minha fila" com contadores no navegador
- **Proposta:** pasta **Filas** no Navegador do Sistema com contadores, como as filas
  do HPSM: "Pendentes (12)", "Em análise (3)", "Concluídas hoje (5)". Cada item abre o
  Histórico Global já filtrado (depende da ideia 5).
- **Onde mexer:** API `GET /api/entries/counts` (um `groupBy` por status);
  `HpsmSidebar.tsx` (folhas com contador, atualização periódica via React Query).

### 7. Atribuição de amostra a um analista
- **Proposta:** campo **Responsável** na triagem e ação "Assumir análise" na toolbar,
  evitando dois analistas na mesma amostra; filtro "Responsável" nas listas; fila
  "Atribuídas a mim" (ideia 6).
- **Onde mexer:** `Entry.assigneeId` no `schema.prisma` + migração; `PatchSchema` em
  `routes/entries.ts`; `EntryDetailPage.tsx`; `EntriesTable.tsx` (coluna).

### 8. Aba "Histórico" (auditoria) na amostra
- **Proposta:** aba **Histórico** com a linha do tempo da amostra: envio, mudanças de
  status/veredito (de → para), relatórios publicados, abertura/descarte de sandbox —
  quem e quando. Equivale à aba "Atividades" do HPSM.
- **Onde mexer:** modelo `EntryEvent` + migração; gravação nos pontos de mudança em
  `routes/entries.ts`, `routes/reports.ts` e `routes/sandbox.ts`;
  `GET /api/entries/:id/events`; nova aba em `EntryDetailPage.tsx` usando a grade.

### 9. Anterior / Próximo na ficha da amostra
- **Proposta:** botões ◀ ▶ na toolbar da amostra para percorrer os resultados da
  lista de onde ela foi aberta, sem voltar à lista.
- **Onde mexer:** `EntriesTable.tsx` guarda os ids da página atual (ex.:
  `sessionStorage` ou contexto do workspace) ao abrir uma linha;
  `EntryDetailPage.tsx` lê e mostra os botões (desabilitados nas pontas).

---

## 🟡 Envio de amostras

### 10. Detecção de duplicata pelo SHA-256
- **Proposta:** ao escolher o arquivo, calcular o SHA-256 no navegador
  (`crypto.subtle.digest`) e consultar a API; se já existir, avisar na barra de
  mensagens "Esta amostra já foi enviada" com link para o registro e o veredito.
  O envio continua permitido (contexto novo pode ser útil).
- **Onde mexer:** `SubmitPage.tsx`; API com busca **exata** por hash (hoje `q`
  procura `contains`), ex. `GET /api/entries?sha256=`.
- **Cuidados:** arquivos grandes — calcular sob demanda e mostrar `HpsmLoading`.

### 11. Arrastar e soltar o arquivo
- **Proposta:** área de soltar na seção "Dados do arquivo" mostrando nome, tamanho e
  (com a ideia 10) o hash antes do envio.
- **Onde mexer:** `SubmitPage.tsx` (`FileUploaderDropContainer` do Carbon ou área
  própria com o skin HPSM).

---

## ⚪ Acabamento

### 12. Botões de copiar
- **Proposta:** ícone de copiar ao lado de SHA-256, URL e IOCs, com "Copiado." na
  barra de mensagens.
- **Onde mexer:** prop `copyable` em `HpsmReadonly` (`components/HpsmForm.tsx`) usando
  `navigator.clipboard`; usos em `EntryDetailPage.tsx` e `EntryReportsTab.tsx`.

### 13. Avisos ao entrar
- **Proposta:** na Página Inicial, mensagem "2 amostras suas foram concluídas desde a
  sua última visita" com link para Meus Uploads.
- **Onde mexer:** `User.lastSeenAt` (ou data da sessão anterior) + endpoint de
  novidades; `WelcomePage.tsx`.

### 14. Prazo do sandbox à vista
- **Proposta:** tempo restante no título da aba de documento da amostra
  ("instalador.exe · 12min") e aviso na barra de mensagens 5 minutos antes de a VM
  expirar, com atalho para "Estender prazo".
- **Onde mexer:** `useSandboxCountdown` (`components/sandboxStatus.ts`) +
  `useWorkspaceTitle` em `EntryDetailPage.tsx`; aviso em `SandboxPanel.tsx`.

### 15. Atalhos de teclado
- **Proposta:** `/` foca a busca da lista, `Alt+N` abre Enviar Amostra, `Ctrl+S`
  salva o formulário aberto (toolbar), `Alt+W` fecha a aba de documento. Lista na
  Página Inicial (seção Dicas).
- **Onde mexer:** um *handler* global em `AppShell.tsx`; registro do "salvar" atual
  via contexto pelas páginas com formulário.

### 16. Linhas da grade navegáveis pelo teclado
- **Proposta:** linhas focáveis, setas ↑↓ movem o foco, Enter abre a amostra; linha
  com foco destacada como a seleção do HPSM. Hoje só abre com o mouse.
- **Onde mexer:** `EntriesTable.tsx` (`tabIndex`, `onKeyDown`, *roving tabindex*).

### 17. Exportar CSV da lista filtrada
- **Proposta:** ação **Exportar CSV** na linha de filtros (ou menu "Mais ▾"),
  respeitando filtros e ordenação.
- **Onde mexer:** API `GET /api/entries/export.csv` com os mesmos parâmetros de
  `ListQuery` (sem o limite de 100); botão em `HpsmFilterBar`.
