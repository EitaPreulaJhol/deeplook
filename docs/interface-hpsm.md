# 🖥️ Interface no estilo HP Service Manager 9

Este guia descreve como a interface do DeepLook foi construída para se parecer com o
**web client do HP Service Manager 9** e como manter esse visual ao criar ou alterar
telas. A regra geral é **não modernizar**: densidade alta, fonte pequena, cinzas com
gradiente, texto em vez de "pílulas" e uma estrutura de área de trabalho com abas.

> O app usa **React + Vite + @carbon/react**. O Carbon fornece o comportamento dos
> controles (campos, selects, tabelas); a aparência HPSM vem dos tokens `--dl-*` e
> do skin em `apps/web/src/styles/hpsm.scss`, que sobrescreve o que o Carbon desenha.

---

## 1. Estrutura da tela

```
┌───────────────────────────────────────────────────────────────────────────┐
│ DeepLook                  Ir para: [__________]      Ana Souza ▾ (Admin)   │  masthead
├──────────────────────┬────────────────────────────────────────────────────┤
│ Navegação            │ [Página Inicial ×] [Histórico Global ×] [Amostra ×]│  abas de documento
│  🏠 Página Inicial   ├────────────────────────────────────────────────────┤
│  ⊟ 📁 Amostras       │ ⓘ Mensagens (erros, avisos, confirmações)          │  barra de mensagens
│     Histórico Global │ ┌─ Título da página ───────────────────────────────┐│
│     Meus Uploads     │ │ [Voltar] [Atualizar] | [Baixar amostra]          ││  toolbar do registro
│     Enviar Amostra   │ │ ⊟ Seção  Rótulo: [campo]   Rótulo: [campo]       ││  formulário
│  ⊟ 📁 Administração  │ └──────────────────────────────────────────────────┘│
└──────────────────────┴────────────────────────────────────────────────────┘
```

| Parte | Componente | Arquivo |
|---|---|---|
| Casca (junta tudo) | `AppShell` | `components/AppShell.tsx` |
| Masthead azul | `HpsmTopBar` + `HpsmUserMenu` | `components/HpsmTopBar.tsx`, `components/HpsmUserMenu.tsx` |
| Navegador em árvore | `HpsmSidebar` | `components/HpsmSidebar.tsx` |
| Abas de documento | `WorkspaceProvider` + `WorkspaceTabs` | `components/workspace.tsx` |
| Barra de mensagens | `HpsmMessageBar` + `HpsmMessage` | `components/messages.tsx` |

- **Masthead:** marca à esquerda; "Ir para:" (rótulo e campo) centralizado na barra,
  independente da largura do logo e do nome; à direita, "Nome ▾ (Papel)". O nome do usuário
  abre um submenu (Minha conta, Alterar senha, Preferências, Sair) — é o único lugar
  do "Sair". No celular, o papel "(Admin)" some e o nome continua abrindo o menu.
- **Navegador do Sistema:** sempre visível no desktop (não recolhe); as pastas recolhidas ficam salvas nas preferências do usuário (`closedFolders`). Abaixo de
  `52rem` vira um drawer aberto pelo botão ☰. Itens novos entram em `ROOT_LEAVES`
  (soltos no topo) ou em `TREE` (dentro de uma pasta) em `HpsmSidebar.tsx`; pastas
  podem ser restritas (`access: 'triage' | 'admin'`) e folhas podem ter contador
  (`count`) e bolinha de status (`tone`). A pasta **Filas** (analistas/admins) mostra
  Pendentes / Em análise / Concluídas com contadores (`GET /api/entries/counts`). O
  destaque vai para a folha mais específica que bate com a URL.
- **Abas de documento:** cada tela aberta vira uma aba com **×** (clique do meio
  também fecha). Limite de 10 abas; a mais antiga sai primeiro. Uma navegação com
  `state: { replaceTab: pathnameAtual }` troca o registro **na mesma aba** (usado pelo
  Anterior / Próxima da amostra).
- **Barra de mensagens:** todas as mensagens da página aparecem empilhadas aqui, no
  topo da área de trabalho, como no HPSM.

---

## 2. Tokens e tipografia

Todos os valores visuais estão em `apps/web/src/styles/_tokens.scss` (fonte única).
Não use cores ou medidas soltas nos componentes: crie ou reaproveite um token.

| Grupo | Tokens principais | Valor / uso |
|---|---|---|
| Tipografia | `--dl-font-sans`, `--dl-font-size` | Tahoma/Arial, **12px** no app inteiro |
| Controles | `--dl-control-h` | **24px** de altura para campos, selects e botões |
| Grade (tabelas) | `--dl-grid-head-1/2`, `--dl-grid-head-border`, `--dl-grid-line` | cabeçalho em gradiente cinza, divisórias verticais |
| Seções | `--dl-section-head-1/2`, `--dl-section-title`, `--dl-section-toggle-border` | cabeçalho azul-claro com título `#15428b` e caixinha +/− |
| Campos | `--dl-field-label-w`, `--dl-readonly-bg`, `--dl-readonly-border` | coluna de rótulos (9rem) e campo travado cinza |
| Botões | `--dl-btn-*` | gradiente cinza; hover azul-claro; `--dl-btn-primary-border` para a ação padrão |
| Status | `--dl-status-green/red/orange/blue/gray` | bolinha ao lado do texto de status |
| Navegador | `--dl-sidebar-*`, `--dl-tree-*` | fundo branco, seleção `#dfe8f6`, guia pontilhada |
| Abas de documento | `--dl-doctabs-*`, `--dl-doctab-*` | faixa e abas com gradiente |
| Login | `--dl-auth-width`, `--dl-auth-label-w` | largura da caixa e coluna de rótulos |

Arquivos de estilo:

| Arquivo | Papel |
|---|---|
| `styles/_tokens.scss` | tokens `--dl-*` |
| `styles/hpsm.scss` | skin do app logado: tokens do Carbon → paleta HPSM e todos os componentes `hpsm-*`/`dl-*` |
| `styles/auth.scss` | páginas públicas (home, login, cadastro) e o botão `.dl-btn` sem Carbon |
| `styles/app.scss` | entrada dos estilos e layout da casca |

---

## 3. Componentes

### Toolbar do registro — `components/HpsmToolbar.tsx`

Ações da tela (Voltar, Salvar, Cancelar…) ficam numa toolbar logo abaixo do título,
com botões pequenos de ícone + texto. **Não** use botões grandes no meio do conteúdo.

```tsx
<HpsmToolbar label="Ações da amostra">
  <HpsmToolbarButton label="Voltar" icon={IconArrowLeft} onClick={() => navigate(-1)} />
  <HpsmToolbarButton label="Atualizar" icon={IconRefresh} onClick={reload} />
  <HpsmToolbarDivider />
  <HpsmToolbarButton label="Baixar amostra" icon={IconDownload} href={url} disabled={!url} />
</HpsmToolbar>
```

Dentro de uma `HpsmSection`, a toolbar encosta no topo do corpo da seção.

### Formulários — `components/HpsmForm.tsx`

| Componente | Uso |
|---|---|
| `HpsmSection` | grupo recolhível (+/−) com título |
| `HpsmForm` | grade de campos; `columns={2}` divide em duas colunas a partir de 64rem |
| `HpsmField` | rótulo à esquerda com `:` e controle ao lado; `required` (asterisco), `wide` (linha inteira), `top` (multilinha), `help` (texto abaixo) |
| `HpsmFormActions` | rodapé do formulário: botões alinhados à coluna dos controles (ex.: **Salvar** da Alterar senha), além da barra da seção |
| `HpsmReadonly` | valor travado em caixa cinza; `multiline`, `mono`, `copyable={{ value, label }}` (botão de copiar) |

```tsx
<HpsmSection title="Triagem">
  <HpsmForm columns={2}>
    <HpsmField label="Status" htmlFor="triage-status">
      <Select id="triage-status" labelText="Status" hideLabel ...>...</Select>
    </HpsmField>
    <HpsmField label="Enviado por">
      <HpsmReadonly>{entry.owner.displayName}</HpsmReadonly>
    </HpsmField>
  </HpsmForm>
</HpsmSection>
```

**Validação:** `const check = useRequiredFields([{ id: 'report-summary', label: 'Resumo',
ok: resumo.length >= 3 }])`; no salvar, `if (!check.check()) return;`, mostre
`check.message` com `HpsmMessage` e passe `invalid={check.isInvalid('report-summary')}`
ao `HpsmField` — rótulo/borda vermelhos, mensagem na barra e foco no primeiro inválido.
Se o formulário continua na tela depois de salvar (campos limpos), chame `check.reset()`
para o destaque não voltar sobre os campos vazios.

**Erros de validação da API:** na API, responda com `sendValidationError(reply,
parsed.error)` (`lib/validation.ts`): 400 com `details` por campo, em português. No
front, declare o campo com `api` (nome no `details`, se diferente do `id`) e `value`, e
no `catch` use `if (!check.fromApi(err)) setError(...)`:

```tsx
const check = useRequiredFields([
  { id: 'url-title', label: 'Título', ok: true, api: 'title', value: urlTitle },
]);
```

O campo citado ganha o destaque e a mensagem "Corrija os campos destacados: Título
(mínimo de 2 caracteres)."; o destaque some quando o valor muda. Nos formulários de
login/cadastro, `AuthField` aceita `invalid`.

> **Rótulos e acessibilidade:** o controle do Carbon recebe `labelText` + `hideLabel`
> (o nome acessível continua no controle) e o `HpsmField` recebe o mesmo `htmlFor`.
> O rótulo visível fica com `aria-hidden` para o leitor de tela não ler duas vezes.

### Listas — `components/EntriesTable.tsx` e `components/HpsmFilterBar.tsx`

- Grade compacta (`size="xs"`), cabeçalho ordenável (ordenação **no servidor**,
  parâmetros `sort`/`dir` de `GET /api/entries`) e rodapé
  "Exibindo registros X a Y de N" com « ‹ Anterior · Próxima › ».
- Filtros numa linha fixa acima da lista (`HpsmFilterBar` + `HpsmFilterItem`), com
  botão **Limpar**. A lista se atualiza sozinha (a busca espera 300ms).
- Teclado: só uma linha entra no Tab; ↑ ↓ Home End movem o foco e Enter abre a
  amostra (a linha com foco recebe o destaque de seleção).
- Atualização em massa (analistas): coluna de seleção (Espaço marca a linha) e a barra
  `EntriesBulkBar` ("N selecionadas: Status / Veredito / Prioridade / Responsável / Resolução [Aplicar]") →
  `POST /api/entries/bulk`, com confirmação.
- Painel de detalhe (preferência `detailPane`, desligada por padrão): clique/setas
  selecionam e mostram o resumo abaixo da grade (`EntryPreviewPane`); duplo clique ou
  Enter abrem a ficha.
- Abrir uma linha guarda a sequência da página (`components/entryNav.ts`); a ficha da
  amostra mostra **◀ Anterior / Próxima ▶** e "Registro N de M" na toolbar.
- Lista vazia: a grade continua visível e o aviso vai para a barra de mensagens
  (`<HpsmMessage kind="info">Nenhuma amostra encontrada.</HpsmMessage>`).

### Status em texto — `components/tags.tsx`

Status, veredito, papel e tipo são **texto**, nunca a `Tag` ("pílula") do Carbon:

```tsx
<StatusText tone="green">Ativo</StatusText>   // bolinha verde + texto
<VerdictTag verdict={entry.verdict} />          // tons já mapeados
<RoleTag role={user.role} />                    // texto puro
```

Tons: `green`, `red`, `orange`, `blue`, `gray` e `none` (sem bolinha).

### Mensagens e carregamento — `components/messages.tsx`

```tsx
{error && <HpsmMessage kind="error">{error}</HpsmMessage>}
{query.isLoading && <HpsmLoading text="Carregando amostras..." />}
```

- `HpsmMessage` (`error`, `warning`, `info`, `success`) é renderizado por portal na
  barra de mensagens da casca. Fora da casca (login, janela do console) aparece no
  próprio lugar. Use o texto direto, sem título "Erro" (o ícone já diz).
- `HpsmLoading` é a caixinha "Carregando…" com o anel de pontos.

### Abas — `components/HpsmTabs.tsx` e `components/workspace.tsx`

- Abas **internas** da página (Detalhes / Análise / Relatórios) usam `HpsmTabs`. A
  aba ativa fica na URL (`?tab=`), para o navegador e o menu poderem apontar direto
  para ela e para a aba de documento reabrir no mesmo ponto.
- Para dar nome à aba de **documento** (ex.: o título da amostra), chame
  `useWorkspaceTitle(titulo)` na página. Se o título tiver informação viva (ex.:
  "12min · nome" do sandbox), passe o nome simples no 2º argumento
  (`titleOnLeave`): ele é aplicado quando a tela é desmontada. Rotas novas precisam de um título padrão em
  `routeTitle()` (`workspace.tsx`), senão não abrem aba.

### Arquivo — `components/HpsmFileDrop.tsx`

`<HpsmFileDrop files={files} onChange={setFiles} multiple maxFiles={20} onLimit={…} />`
— área "Arraste os arquivos aqui ou [Selecionar arquivos]" e uma linha por arquivo
(nome, tamanho, Remover), com o total quando há mais de um. Sem `multiple`, a escolha
troca o arquivo. Usado no lugar do `FileUploader` do Carbon. `formatFileSize()` vem do
mesmo arquivo.

### Atalhos de teclado — `components/shortcuts.tsx`

| Tecla | Ação |
|---|---|
| `Ctrl+K` | foca o "Ir para:" do masthead (ID, SHA-256 ou texto) |
| `/` | foca a busca da lista (fora de campos de texto) |
| `Alt+N` | abre Enviar Amostra |
| `Alt+W` | fecha a aba de documento atual |
| `Ctrl+S` | salva o formulário aberto |
| `↑ ↓ Home End` + `Enter` | navegam e abrem amostras na grade |
| `?` (fora de campos) / `F1` | abre a caixa **Atalhos de teclado** (também no menu do usuário) |

Para o `Ctrl+S` valer numa tela nova: `useSaveShortcut(salvar, !salvando)` — e ponha
`title="Salvar (Ctrl+S)"` no botão da toolbar.

**Lista única:** todo atalho novo entra em `SHORTCUT_GROUPS`
(`components/shortcutList.tsx`). Dela saem a caixa `HpsmShortcutsHelp` (`?`/F1) e as
Dicas da Página Inicial (itens com `tip: true`); `<ShortcutKeys keys={[['Ctrl', 'K']]} />`
desenha as teclas. Com qualquer `.hpsm-modal` aberto, os atalhos globais ficam
desligados; F1 sempre leva `preventDefault` (não abre a ajuda do navegador).

### Copiar — `components/CopyButton.tsx`

`<CopyButton value={codigo} label="chave" />` — ícone de copiar que confirma "Copiado"
no próprio botão. Em campos travados, prefira `<HpsmReadonly copyable={{ value, label }}>`.

### Confirmação — `components/HpsmConfirm.tsx`

Ações destrutivas pedem confirmação numa caixa no estilo HPSM (foco inicial em
**Não**, Esc cancela):

```tsx
const confirm = useConfirm();
if (await confirm({ title: 'Revogar chave', message: '...', confirmLabel: 'Revogar', danger: true })) {
  await revokeKey(key);
}
```

O `ConfirmProvider` fica em `main.tsx`, então funciona também fora da casca (janela do
console).

Para pedir um texto (nome de visão, renomear), use `usePrompt` do mesmo arquivo: devolve
o texto aparado ou `null` (Cancelar/Esc); o botão de confirmar fica desabilitado com o
campo vazio.

```tsx
const prompt = usePrompt();
const nome = await prompt({ title: 'Salvar visão', label: 'Nome', defaultValue: sugestao });
```

### Menu de contexto — `components/HpsmContextMenu.tsx`

`<HpsmContextMenu x y label items={[{ label, icon?, action, disabled?, separated? }]}
onClose={(restaurarFoco) => ...} />` — menu flutuante no desenho do menu do usuário
(portal no `body`, não sai da janela). Setas pulam itens desabilitados, Esc/Tab fecham
devolvendo o foco a quem abriu, clique fora fecha. Abra pelo `onContextMenu` (posição
do mouse) e por Shift+F10 / tecla Menu (posição do elemento).

### Menu "Mais" da toolbar — `HpsmToolbarMenu` em `components/HpsmToolbar.tsx`

`<HpsmToolbarMenu label="Mais" items={[{ label, icon?, action, disabled?, separated? }]} />`
— botão "Mais ▾" que abre o `HpsmContextMenu` logo abaixo dele (teclado: Enter, Espaço
ou ↓ abrem; Esc fecha e volta ao botão). Use para ações menos frequentes do registro.

### Ficha para impressão — `pages/EntryPrintPage.tsx`

Rota `/entries/:id/imprimir` fora da casca, aberta por "Mais ▾ > Imprimir ficha…" com
`?auto=1`. Estilos em `.dl-print*` (`hpsm.scss`, seção 12i) com `@media print`. Ao
acrescentar dados à ficha, nunca inclua nada do ambiente isolado.

### Notificações — `lib/notifications.ts` (API) e `components/notifications.ts`

Na API, notifique com `notify(tx, [{ userId, type, entryId, actorId, detail }])` dentro
da mesma transação do evento; ele ignora a própria pessoa e destinatários repetidos. No
front, `useNotificationCount()` (contador compartilhado), `useNotifications(limit,
somenteNaoLidas)`, `useMarkRead()`, `notificationText(n)` e `notificationHref(n)`.
Avisos do sistema (prazo, `lib/sla-escalation.ts`) usam `actorId: null`.

### Menções — `components/MentionTextArea.tsx`

`<MentionTextArea id value onChange onMention />` no lugar do `TextArea`: "@" abre a
lista de pessoas e insere "@Nome". Envie os ids das menções que continuam no texto e
use `renderMentions(texto, event.toValue)` para destacar os nomes.

### Indicadores — `components/iocs.ts` e `pages/IocPage.tsx`

`iocHref(kind, valor)` monta o link da ficha; `iocKindOf(valor)` deduz o tipo de um
valor já normalizado; `shortIoc` encurta hashes para a grade; `looksLikeIoc(texto)`
decide se o "Ir para:" consulta `/api/iocs/lookup`. Para baixar algo gerado pela API,
use `downloadUrl(url)` (`components/entryExport.ts`), sem o atributo `download`: o nome
vem do `Content-Disposition`.

### Prazo — `components/sla.tsx`

`<AgeText entry={entry} sla={sla} />` mostra a idade no status atual ("1 d 6 h") com o
marcador do prazo: nada no prazo, laranja acima de `warnHours`, vermelho acima de
`lateHours`, "—" nas concluídas. Os limites vêm da API (`sla` na resposta da lista e da
ficha); passe `sla` ao `EntriesTable` para a coluna Idade ganhar os marcadores.

### Favoritos — `components/favorites.ts`

`useFavorites()` devolve `favorites` e as ações `addView(nome, url)`, `pinEntry(id)`,
`rename`, `remove` e `move(id, -1 | 1)`; os erros da API (limite, repetido) chegam como
exceção para a tela mostrar na barra. `currentViewUrl(pathname, search)` monta a URL
da visão sem a página; `suggestViewName(base, partes)` sugere o nome. Na barra de
filtros, basta passar `viewName` ao `HpsmFilterBar` para aparecer **Salvar visão**.

### Alterações não salvas — `components/useUnsavedChanges.ts`

Formulários com conteúdo digitado avisam antes de perdê-lo (trocar de tela ou de aba
interna, Voltar, fechar a aba de documento, recarregar a janela):

```tsx
const { allowNavigation } = useUnsavedChanges(Boolean(title || description));
// depois de salvar com sucesso e antes de redirecionar:
allowNavigation();
navigate(`/entries/${id}`);
```

Usa o `useBlocker` do React Router, que só funciona com *data router* — por isso o
`main.tsx` usa `createBrowserRouter` com uma rota `*` que renderiza o `App`. Só um
formulário com o hook pode estar montado por vez (limite do `useBlocker`).

O **Sair** do menu do usuário também respeita o aviso: o hook registra os formulários
com alteração pendente (`hasUnsavedChanges()`), e a barra superior pergunta antes de
encerrar a sessão. Confirmado o descarte, `discardUnsavedChanges(fn)` libera a navegação
para o login sem um segundo aviso.

### Estado das listas na URL — `components/useEntryListState.ts`

Busca, filtros, ordenação e página das listas ficam na URL
(`?q=&status=&sort=&dir=&offset=`): a aba de documento reabre a lista como estava e a
busca pode ser compartilhada por link. Use o hook em qualquer lista nova de amostras.

### Cabeçalho da página — `components/PageHeader.tsx`

`<PageHeader title="..." subtitle="..." />` — faixa com título e subtítulo.

### Páginas públicas — `components/AuthLayout.tsx` e `components/AuthField.tsx`

Login, cadastro e home usam `PublicMasthead`, a caixa `.dl-box` com cabeçalho e
`PublicLegal`. `AuthLayout` aceita `altLink` (link para a outra tela, abaixo da caixa
à direita). Os botões são `.dl-btn` / `.dl-btn--primary` (sem Carbon).

---

## 4. Convenções e armadilhas do Carbon

**Faça assim**

- Botões do Carbon dentro do app viram automaticamente o botão cinza do HPSM. O
  `kind` muda só detalhes: `primary` = negrito (ação padrão), `ghost` = sem moldura,
  `danger*` = texto vermelho.
- Toda mensagem ao usuário passa por `HpsmMessage`; nada de `InlineNotification`.
- Fonte e alturas vêm dos tokens; controles do Carbon já são ajustados para 12px/24px
  dentro de `.dl-shell` e `.dl-console-window`.

**Evite**

- `Tag` do Carbon para status (use `StatusText`).
- `DataTable` do Carbon para listas cujos dados mudam (filtro, paginação): ele guarda
  as linhas em estado interno e sincroniza **um render depois**, entregando ids que
  não existem mais (`entry` vira `undefined` e a tela fica branca). `EntriesTable`
  renderiza as linhas direto dos dados. As tabelas do Admin ainda usam `DataTable`,
  mas ignoram ids antigos (`if (!u) return null`).
- Popovers e caixas tracejadas de "vazio" — não fazem parte do HPSM.

**Ajustes que o skin faz no Carbon** (se algo "voltar ao Carbon", procure aqui em
`hpsm.scss`):

| Problema do Carbon | Correção |
|---|---|
| `th[aria-sort]` zera o padding, força 48px de altura e tira a borda | regra própria para `th[aria-sort]` |
| ícone do botão com `position: absolute` (fica sobre o texto) | `position: static` e ícone antes do texto |
| `::placeholder` do textarea com 14px fixos | `font-size: inherit` |
| `padding-block` sobrando nos campos de 24px (texto do select sobe) | `padding-block: 0` |
| `Tile` e `p` com fonte própria (14–16px) | fonte do corpo (12px) |

---

## 5. Rotas do front

| Rota | Tela | Observação |
|---|---|---|
| `/home`, `/login`, `/register` | páginas públicas | só sem sessão |
| `/` | — | redireciona para a página inicial das preferências |
| `/inicio` | Página Inicial | boas-vindas; padrão após o login |
| `/history` | Histórico Global | |
| `/me` | Meus Uploads | a resolução para quem enviou aparece abaixo do título |
| `/submit` | Enviar Amostra | abas Arquivo / Link |
| `/entries/:id` | Amostra | `?tab=analise`, `?tab=relatorios`, `?tab=relacionadas`, `?tab=mapa`, `?tab=historico` |
| `/revisoes` | Relatórios para revisar (quatro olhos) | só analistas; abre a aba Relatórios da amostra |
| `/painel` | Painel (indicadores, gráfico diário, vereditos, carga) | `?dias=30\|90`; pode ser a página inicial |
| `/dominios-empresa` | Domínios da empresa (analistas veem; admin cadastra) e variações vistas | pasta Detecção |
| `/regras-triagem` | Regras de triagem (analistas): tags e prioridade automáticas | pasta Detecção |
| `/avisos` | Avisos gerais (analistas): publicar, lista e encerrar | pasta Gestão; a faixa aparece no topo de todas as telas |
| `/atribuicao` | Atribuição automática (analistas): regras, grupos e ausências | pasta Gestão |
| `/gerencial` | Relatório gerencial (analistas) | `?de=AAAA-MM-DD&ate=AAAA-MM-DD`; `/gerencial/imprimir` para impressão |
| `/inbox` | Caixa de entrada (notificações) | também na raiz do navegador, com o contador |
| `/iocs/:tipo/:valor` | Ficha do indicador (ipv4, domain, email, md5, sha1, sha256) | aberta pelo "Ir para:" e pelos links de IOCs |
| `/entries/:id/imprimir` | Ficha para impressão (sem a casca) | `?auto=1` abre a impressão ao carregar |
| `/casos/:id/imprimir` | Caso para impressão (sem a casca) | `?auto=1` abre a impressão ao carregar |
| `/admin` | Administração | só ADMIN; `?tab=keys`, `tokens`, `templates`, `status`, `audit`, `trash` |
| `/user` | Minha Conta | `?tab=senha`, `?tab=preferencias`, `?tab=tokens` |
| `/admin?tab=backup` | Backup (admin): gerar o ZIP, acompanhar, baixar e excluir | também na pasta Administração |
| `/user/api` | Documentação da API: exemplos em curl e as rotas lidas do `openapi.json` | link na aba Tokens de API |
| `/sandbox/entry/:entryId/console` | janela do console | fora da casca |

---

## 6. Minha Conta e preferências

### Endpoints

| Método | Rota | Função |
|---|---|---|
| GET | `/api/auth/options` | público: `{ ldap }` (login pelo AD ligado: o campo aceita o usuário da rede) |
| GET | `/api/auth/me` | usuário da sessão, incluindo `preferences` (já completadas com os padrões) |
| POST | `/api/auth/touch` | atividade do usuário: renova a sessão por `SESSION_IDLE_MINUTES` e devolve `{ expiresAt }` (401 se já expirou) |
| GET | `/api/auth/session` | `{ expiresAt }` da sessão atual, **sem** renovar |
| PATCH | `/api/me/preferences` | atualização parcial; chaves desconhecidas → 400 |
| POST | `/api/me/password` | `{ currentPassword, newPassword }`: confere a atual, exige a política de senha (8+ caracteres, número e caractere especial) e senha diferente, e **encerra todas as sessões** do usuário. Na troca obrigatória (senha redefinida pelo admin) abre uma sessão nova e devolve `{ ok, signedIn: true }` |
| POST | `/api/admin/users/:id/reset-password` | admin: gera senha temporária (devolvida uma vez), encerra as sessões e marca a **troca obrigatória**: até trocar, as rotas respondem 403 `{ code: 'PASSWORD_CHANGE_REQUIRED' }` (inclusive para os tokens de API), exceto a troca de senha |

| GET | `/api/analysts` | analistas/admins ativos (select de Responsável); só para analistas |
| GET | `/api/entries/counts` | contadores das filas: `{ counts: { PENDING, IN_REVIEW, COMPLETED }, mine }` |
| GET | `/api/entries/:id/events` | histórico da amostra (aba Histórico) |
| POST | `/api/entries/file` | envio de arquivo (multipart: `file`, `title?`, `description?`, `tags?`) → `{ entry, previous }` (`previous` = primeira amostra com o mesmo SHA-256) |
| POST | `/api/entries/zip` | `.zip` desmembrado (multipart: `file`, `password?`, `description?`, `tags?`) → `{ created: [{ name, path, entry, previous }], skipped: [{ name, path, reason }] }`; até 20 arquivos; senha errada → 400 com `details.password` |
| GET | `/api/entries/:id/hex?offset=&length=` | analistas: bytes do arquivo para o visualizador hexadecimal (`Range` no MinIO, blocos de até 4 KB, até 64 KB) |
| POST | `/api/entries/next` | analistas: "Pegar a próxima" - atribui a pendente sem responsável mais antiga, põe Em análise e devolve `{ entry: { id, title } }`; 404 sem nenhuma |
| POST | `/api/entries/bulk` | atualização em massa `{ ids (1–100), patch: { status?, verdict?, priority?, assigneeId?, resolution? } }` (analistas); a resolução segue as regras da ficha |
| GET | `/api/entries/export.csv` | lista filtrada/ordenada em CSV (mesmos parâmetros da lista, sem paginação) |
| GET | `/api/me/updates` | amostras do usuário concluídas desde a visita anterior (Página Inicial) |
| GET | `/api/entries` | aceita também `age=warn\|late` (não concluídas há mais de `SLA_WARN_HOURS`/`SLA_LATE_HOURS` no status) e `sort=age`; `attack=T1566` (relatório publicado com a técnica ou subtécnicas); devolve `sla: { warnHours, lateHours }` |
| GET | `/api/entries/counts` | inclui `late` (fila Atrasadas) |
| POST | `/api/entries/:id/static-analysis` | reanalisa o arquivo (analistas); a análise do envio vem em `entry.staticInfo` |
| POST | `/api/entries/:id/duplicate` | `{ of }` marca como duplicata da principal (analistas); conclui com o veredito dela |
| DELETE | `/api/entries/:id/duplicate` | desfaz e restaura status/veredito anteriores |
| POST | `/api/reports/:id/submit` · `/approve` · `/return` | revisão de relatório: enviar, aprovar (publica) e devolver `{ note }`; o autor não revisa o próprio |
| GET | `/api/reports/review-queue` | relatórios em revisão de outros analistas |
| PATCH | `/api/reports/:id` | edita (autor ou admin): `{ summary?, findings?, iocs?, verdict?, attackTechniques?, kbArticleIds?, status? }`; só o que vier muda; mudou o conteúdo, a versão anterior fica guardada |
| POST | `/api/reports/:id/evidence` | evidência (multipart `file` + `caption`): PNG/JPEG/WebP pelo tipo real, até 10 MB e 20 por relatório, metadados removidos → `{ evidence, metadataRemoved }` |
| GET · PATCH · DELETE | `/api/evidence/:id` | a imagem (com `nosniff` e CSP `sandbox`; usuário comum só de relatório publicado) · `{ caption }` · exclui no MinIO |
| GET | `/api/reports/:id/versions` | versões do relatório (analistas), da 1ª à atual: `{ versions: [{ number, current, author, at, status, summary, findings, iocs, verdict, attackTechniques }] }` |
| POST | `/api/iocs/import/preview` | `{ target: 'watch' \| 'allow', text }` (CSV/lista ou STIX 2.1) → `{ format, items: [{ kind, value, where, fromUrl?, status }], invalid, repeated, counts, room }` |
| POST | `/api/iocs/import` | `{ target, items: [{ kind, value }], reason? }` → `{ added, rejected, exists, covered, limit }` (permitidos: analistas, motivo obrigatório) |
| POST | `/api/entries/:id/capture` | captura da página do link (analistas; 202, roda em segundo plano; 409 se já há uma em andamento; 503 desligada) |
| GET | `/api/entries/:id/captures` | `{ captures: [{ id, status, url, finalUrl, title, httpStatus, redirects, certificate, blocked, htmlTruncated, error, createdAt, finishedAt, requestedBy }], enabled }` |
| GET | `/api/captures/:id/screenshot` · `/html` | print (PNG) · HTML só como anexo de texto |
| POST | `/api/entries/:id/extract-image` | imagem de disco (ISO/FAT/VHD): extrai até 50 arquivos como amostras filhas (analistas; 409 se já extraiu; 410 expurgado) → `{ created, children, skipped }` |
| GET | `/api/entries/:id/children` | amostras filhas (anexos de e-mail, arquivos extraídos): `{ children: [{ id, title, originalFilename, status, verdict }] }` |
| GET · POST · DELETE | `/api/company-domains[/:id]` | domínios da empresa: lista `{ domains, seen: [{ domain, companyDomain, reason, label, detail, sources, total, entries }], max: 20 }` (analistas); incluir `{ domain }` (admin; normaliza URL/www; 409 repetido ou acima de 20; entra na lista de permissões e revarre as amostras) e excluir (admin; tira só o item que o cadastro pôs na lista de permissões). `GET /api/entries/:id` traz `lookalikeHits` |
| GET · POST · PATCH · DELETE | `/api/triage-rules[/:id]` | regras de triagem (analistas): `{ name, condition, value?, tags, priority? }` (`LOOKALIKE`: valor opcional, o domínio da empresa) · `{ enabled }`; a lista traz `label` ("domínio do link .top") |
| GET | `/api/broadcasts/active` | avisos gerais ativos que a pessoa não dispensou (todos): `{ items: [{ id, text, level, expiresAt, createdBy, case }] }` |
| POST | `/api/broadcasts/:id/dismiss` | dispensar o aviso só para a pessoa |
| GET · POST | `/api/broadcasts` | analistas: últimos 30 dias com `active` e `_count.dismissals` · publicar `{ text, level, hours, caseId? }` (409 com 3 ativos) |
| POST | `/api/broadcasts/:id/end` | encerrar agora (analistas; 404 se já encerrado) |
| GET | `/api/assignment` | atribuição automática (analistas): `{ groups: [{ id, name, rules, members: [{ id, displayName, away, available, lastAssignedAt }] }], rules: [{ id, position, groupId, entryType, tag, priority, enabled, label, group }], analysts }` |
| POST · PATCH · DELETE | `/api/assignment/groups[/:id]` | `{ name }` · `{ name? , memberIds? }` · exclui (com as regras) |
| POST · PATCH · DELETE | `/api/assignment/rules[/:id]` | `{ groupId, entryType?, tag?, priority? }` · `{ enabled }` · exclui; `POST /rules/:id/move { direction: 'up' \| 'down' }` |
| PUT | `/api/assignment/away/:userId` | `{ away }`: a própria pessoa ou um admin |
| GET | `/api/management?from=&to=&tz=&format=` | relatório gerencial (analistas): `received`, `completed`, `timeToComplete` (`all`, `byPriority`: `{ n, avgHours, medianHours }`), `verdicts`, `techniques`, `cases`, `workload`; `format=csv` baixa o CSV |
| GET | `/api/dashboard?days=&tz=` | painel: `byStatus`, `byVerdict`, `open`, `period`, `daily` (dias no fuso), `workload` (analistas), `techniques` (ATT&CK mais vistas: `{ id, name, tactics, count }`) |
| GET | `/api/admin/status` | admin: `{ checkedAt, overall, checks: [{ id, name, level, summary, latencyMs?, details }] }` (ok/warn/error/off) |
| GET | `/api/admin/audit?action=&days=&q=&limit=&offset=` | admin: `{ total, items: [{ action, actor, targetUser, targetLabel, detail, ip, createdAt }] }`, mais recentes primeiro |
| GET | `/api/admin/audit/export.csv` | admin: CSV da auditoria com os mesmos filtros |
| GET | `/api/entries/:id/antivirus` | ClamAV: `{ enabled, pending, scan: { status, signature, error, engine, dbVersion, dbDate, scannedAt } }` (aceita token) |
| POST | `/api/entries/:id/antivirus` | analistas: escaneia de novo a partir do MinIO (202); 410 se expurgado |
| GET/POST | `/api/cases` | analistas: casos `{ total, items: [{ id, code, title, status, assignee, entries, updatedAt }] }` (`status=active\|OPEN\|IN_PROGRESS\|CLOSED`, `assignee=me\|none\|id`, `q`); POST `{ title, description?, entryIds[] }` (ao menos uma amostra) |
| GET/PATCH | `/api/cases/:id` | caso com amostras (SHA-256/URL e relatórios publicados) e linha do tempo; PATCH `{ title?, description?, status?, assigneeId? }` |
| GET | `/api/cases/:id/iocs` | IOCs das amostras do caso sem repetir: `{ iocs: [{ kind, value, source, entries: [{ id, title, verdict }] }] }` |
| GET | `/api/cases/:id/iocs/export?format=` | IOCs do caso como anexo: `csv`, `stix` (com `grouping` do caso) ou `misp` |
| POST/DELETE | `/api/cases/:id/entries` · `/api/cases/:id/entries/:entryId` | incluir `{ entryIds[] }` / retirar (409 se for a última); `POST /api/cases/:id/comments { text, mentions? }` (menções só de analistas; avisa mencionados e responsável); `GET /api/cases/counts`; `GET /api/entries/:id/cases` |
| POST | `/api/entries/file` (`.eml`) | e-mail: grava `emailInfo` (cabeçalhos, `auth`, `received`, `links`, `body`, `attachments[{ filename, mimeType, size, entryId?, skipped? }]`) e cria cada anexo como amostra com `parentEntry`; `GET /api/entries/:id` traz `emailInfo` e `parentEntry` |
| GET | `/api/kb?q=&category=&limit=&offset=` | base de conhecimento (todos): `{ total, items: [{ id, title, summary, category, tags, updatedAt, updatedBy, citations }] }` |
| GET | `/api/kb/:id` | artigo `{ ..., body, createdBy, canDelete, revisions: [{ createdAt, editor }], reports: [{ id, updatedAt, analyst, entry }] }` (só relatórios publicados) |
| POST/PATCH/DELETE | `/api/kb` · `/api/kb/:id` | analistas: `{ title, summary, category (MALWARE_FAMILY/SCAM/TECHNIQUE/PROCEDURE), tags[], body }`; 409 título em uso; excluir: autor ou admin. Relatórios aceitam `kbArticleIds` |
| GET | `/api/me/upload-quota` | cota de envio `{ limit, used, remaining, resetAt }` (`limit` null = sem limite); envios acima dela dão 429 `{ error, resetAt }` |
| GET | `/api/search?q=&type=&days=` | busca avançada (português, sem acento; aspas e `-`): `{ groups: { entries, reports, comments, kb, cases } }`, cada um `{ total, items }` com `snippet` (trecho com `⟦ ⟧`); usuário comum só vê relatórios publicados e não vê casos |
| GET/POST | `/api/allowlist` | analistas: lista de permissões `{ items: [{ id, kind, value, reason, createdBy }] }`; POST `{ kind, value, reason }` (normaliza; 400 no campo, 409 repetido) |
| DELETE | `/api/allowlist/:id` | remove da lista (auditoria) |
| POST | `/api/allowlist/filter` | `{ values }` → `{ allowed }`: sugestões cobertas pela lista; `GET /api/iocs/:kind/:value` traz `allowed: { by, reason }` |
| POST | `/api/yara/rules/:id/retroscan` | analistas: YARA retroativo nas amostras guardadas (202 `{ retroscan: { id, total, skipped } }`; 409 se já houver uma em andamento) |
| GET | `/api/yara/retroscans` · `/api/yara/retroscans/:id` | últimas 10 `{ items: [{ ruleName, status, total, scanned, matched, failed, skipped, startedBy, ... }] }`; detalhe com `hits: [{ identifiers, entry }]` (até 500) |
| POST | `/api/yara/retroscans/:id/cancel` | cancela a varredura em andamento (409 se não estiver rodando) |
| GET/POST | `/api/team-views` | analistas: visões da equipe `{ views: [{ id, label, url, createdBy, count, canEdit }] }`; POST `{ label, url }` (só `/history?…`; 409 repetida ou acima de 30) |
| PATCH/DELETE | `/api/team-views/:id` | renomear `{ label }` / remover: quem compartilhou ou admin |
| GET | `/api/entries/compare?a=&b=` | analistas: `{ a, b, sameContent, lists: { iocs, yara, attack, urls, ips, emails, paths, registry, suspicious, imports, suspiciousImports, sections } }`, cada lista `{ common, onlyA, onlyB }` (até 200); 400 mesma amostra, 404 inexistente |
| GET | `/api/attack` | MITRE ATT&CK embutido `{ version, tactics: [{ id, name }], techniques: [{ id, name, tactics }] }` (cache de 1 dia) |
| GET/POST | `/api/yara/rules` | analistas: regras YARA `{ rules: [{ id, name, description, source, enabled, createdBy, updatedBy, updatedAt }] }`; POST `{ name, description?, source, enabled }` compila com o YARA-X antes (400 com `details.source` = saída do compilador; 409 nome em uso) |
| PATCH/DELETE | `/api/yara/rules/:id` | analistas: edita (mesmo corpo do POST) ou só `{ enabled }` (ativar/desativar); exclui |
| POST | `/api/yara/validate` | analistas: `{ source }` → `{ ok, errors, warnings }` sem salvar |
| GET | `/api/entries/:id/yara` | `{ activeRules, pending, scan: { status (PENDING/CLEAN/MATCHED/ERROR), matches: [{ rule, identifier, tags, description, matches }], rulesCount, error, scannedAt } }` |
| POST | `/api/entries/:id/yara` | analistas: aplica as regras ativas de novo (202); 409 sem regra ativa, 410 se expurgado |
| GET | `/api/entries/:id/reputation` | reputação externa `{ services, indicator, pending, results: [{ service, name, status, verdict, summary, link, checkedAt }] }` (aceita token) |
| POST | `/api/entries/:id/reputation` | analistas: consulta de novo, ignorando o cache (202) |
| POST | `/api/auth/login/2fa` | segunda etapa do login com 2FA `{ challenge, code }` (código do aplicativo ou de recuperação) → `{ user, recoveryRemaining }`; o `POST /api/auth/login` de quem tem 2FA devolve `{ twoFactorRequired: true, challenge }` |
| GET | `/api/me/2fa` | `{ enabled, enabledAt, recoveryRemaining }` |
| POST | `/api/me/2fa/setup` · `/enable { code }` | ativar: segredo pendente `{ secret, otpauthUri, qrSvg }` e confirmação → `{ recoveryCodes }` (uma vez) |
| POST | `/api/me/2fa/recovery-codes` · `/disable` | `{ password, code }`: novos códigos (invalida os anteriores) ou desativar |
| POST | `/api/admin/users/:id/disable-2fa` | admin: desativa o 2FA de alguém (celular perdido) |
| POST/DELETE | `/api/iocs/:kind/:value/watch` | seguir / deixar de seguir um indicador (alertas de IOC); `GET /api/iocs/:kind/:value` traz `watching` |
| GET | `/api/me/watches` | indicadores que a pessoa segue |
| GET | `/api/me/sessions` | sessões abertas da conta `{ sessions: [{ handle, device, userAgent, ip, createdAt, lastSeenAt, current }] }` (`handle` = hash, nunca o id) |
| DELETE | `/api/me/sessions/:handle` · POST `/api/me/sessions/revoke-others` | encerra uma sessão (não a atual) ou todas as outras |
| GET/POST | `/api/me/api-tokens` | tokens de API do usuário (`{ apiAccess, maxDays, tokens }`); POST `{ name, expiresInDays }` → `{ token, secret }` (secret só aqui); 403 sem liberação, 409 com 10 ativos |
| DELETE | `/api/me/api-tokens/:id` | revoga um token próprio |
| GET · POST | `/api/admin/backups` | backups (admin): lista (os vencidos expiram na hora) `{ items: [{ id, status, includeSamples, step, progress, size, manifest, error, expiresAt }], retentionDays }`; gerar `{ includeSamples, password }` ou `{ includeSamples, noPassword: true }` → 202 (400 sem escolher, 409 com um em andamento) |
| GET · DELETE | `/api/admin/backups/:id/download` · `/api/admin/backups/:id` | baixar o ZIP (admin com sessão; 404 se não está pronto; auditado) · excluir (409 em andamento) |
| GET | `/api/openapi.json` | especificação OpenAPI 3.1 das rotas que aceitam token (sessão ou token); gerada dos schemas zod (`lib/openapi.ts`), e o teste confere que bate com `ALLOWED_ROUTES` |
| GET | `/api/admin/api-tokens?status=active\|all` | admin: tokens de todos com o usuário |
| DELETE | `/api/admin/api-tokens/:id` | admin: revoga um token |
| PATCH | `/api/admin/users/:id` `{ apiAccess }` | admin: libera ou retira o acesso por API (retirar revoga os tokens ativos) |
| POST | `/api/entries/:id/trash` | admin: move para a lixeira (some de todas as telas); 409 com sandbox ativo |
| GET | `/api/admin/trash?q=&limit=&offset=` | admin: amostras na lixeira `{ total, items: [{ …, owner, deletedBy, deletedAt, filePurgedAt, _count }] }` |
| POST | `/api/admin/trash/:id/restore` | admin: restaura (volta a todas as telas) |
| DELETE | `/api/admin/trash/:id` | admin: exclui de vez (arquivo no MinIO + ficha e tudo ligado a ela) |
| GET | `/api/report-templates` | modelos de relatório (analistas e admin) |
| POST/PATCH/DELETE | `/api/report-templates[/:id]` | admin: `{ name, summary, findings?, iocs?, verdict }`; nome repetido → 409 |
| GET | `/api/me/notifications?limit=&unread=1` | caixa de entrada `{ items, unread }` (ASSIGNED, COMPLETED, MENTION, COMMENT, REPORT_APPROVED, REPORT_RETURNED, IOC_SEEN, SLA_WARN, SLA_LATE, RESOLUTION, CASE_MENTION, CASE_COMMENT, CASE_ENTRY_ADDED, CASE_ENTRY_REMOVED, CASE_ASSIGNED; nos de prazo `actor` é null e `detail` são as horas do prazo; `entry.resolution` é a resolução atual; nos de caso `entry` é null e `case` traz `{ id, code, title }`) |
| GET | `/api/me/notifications/count` | `{ unread }` (sininho, a cada minuto) |
| POST | `/api/me/notifications/read` | `{ ids? }` marca como lidas (sem `ids`: todas) |
| GET | `/api/users/mentionable?q=&analysts=1` | pessoas ativas para o "@" (nome, sem e-mail; até 8); `analysts=1` nos comentários de casos |
| GET | `/api/iocs/lookup?q=` | texto → indicador reconhecido `{ ioc: { kind, value } }` ou 404 |
| GET | `/api/iocs/:kind/:value` | ficha: `{ ioc, items: [{ entry, sightings }], total, firstSeen, lastSeen }` |
| GET | `/api/entries/:id/iocs` | indicadores da amostra (relatórios publicados + arquivo/URL/domínio) |
| GET | `/api/entries/:id/iocs/export?format=` | `csv`, `stix` (STIX 2.1) ou `misp` (evento JSON), como anexo |
| POST | `/api/entries/:id/comments` | nova atualização `{ text, mentions? }` (1–4000, texto puro) → evento `COMMENT` no histórico; 10/min por sessão |
| GET | `/api/entries/:id/related` | aba Relacionadas: `{ items: [{ entry, reasons, score }], total, limit: 50 }`; motivos `SAME_SHA256`, `SAME_HOST`, `SAME_BASE_DOMAIN`, `SHARED_TAGS`, `SHARED_IOCS` (IOCs dos relatórios publicados, `lib/iocs.ts`), `SIMILAR` (arquivo parecido pelo TLSH, `detail` = similaridade em %); `?similarity=` 50–99 (padrão 70) |
| GET | `/api/entries/:id/graph` · `/api/cases/:id/graph` | mapa de relações: `{ center, nodes: [{ id, kind: ENTRY\|IOC\|CASE, label, … }], edges: [{ from, to, label }], hidden: { entries, iocs, cases } }`; amostra até 12 amostras, 12 indicadores e 8 casos (casos só para analistas); caso até 20 amostras e 15 indicadores (os compartilhados primeiro; só analistas); sem os indicadores permitidos |
| GET | `/api/me/favorites` | pasta Favoritos do usuário, em ordem (`entry` resumida nas amostras fixadas) |
| POST | `/api/me/favorites` | `{ kind: 'VIEW', label, url }` ou `{ kind: 'ENTRY', entryId, label? }`; até 30; repetido → 409 |
| PATCH | `/api/me/favorites/:id` | `{ label }` (1–60 caracteres) |
| PUT | `/api/me/favorites/order` | `{ ids }`: todos os ids do usuário na nova ordem |
| DELETE | `/api/me/favorites/:id` | remove o favorito |

`GET /api/entries` aceita também `assignee=me|none|<id>`, `submittedFrom`, `completedFrom` (ISO; links do Painel) e `sort=assignee`;
`PATCH /api/entries/:id` aceita `assigneeId` (id do analista ou `null`) e `resolution`
(resolução para quem enviou, analistas; até 500 caracteres, vazio ou `null` remove).

`POST /api/auth/login` e `POST /api/me/password` aceitam **5 tentativas a cada 5
minutos** (por e-mail e por sessão, respectivamente); depois respondem 429.

Após trocar a senha, o front limpa a sessão e leva ao login com o aviso
"Senha alterada. Entre novamente com a nova senha.".

**Sessão por inatividade:** expira após `SESSION_IDLE_MINUTES` (padrão 30) sem
atividade, com teto absoluto de `SESSION_TTL_HOURS`. O `SessionWatcher` renova com
atividade (no máximo 1x/min), avisa 2 min antes com a caixa "Sessão expirando"
(contagem regressiva, **[Continuar conectado] [Sair]**) e, ao expirar, volta ao login
com "Sua sessão expirou por inatividade. Entre novamente.".

### Preferências

Guardadas na coluna JSON `User.preferences` (migração
`20261021000000_add_user_preferences`).

| Chave | Valores (padrão em negrito) | Onde é aplicada |
|---|---|---|
| `startPage` | **`welcome`** · `history` · `mine` | destino após o login e na raiz `/` |
| `pageSize` | 25 · **50** · 100 | Histórico Global e Meus Uploads |
| `restoreTabs` | **`true`** · `false` | reabre as abas de documento da sessão anterior ao entrar (cópia por usuário no `localStorage`) |
| `detailPane` | `true` · **`false`** | painel de detalhe abaixo das listas (clique seleciona, duplo clique abre) |

### Como adicionar uma preferência

1. **API** — `apps/api/src/lib/preferences.ts`: adicione a chave em
   `PreferencesSchema` e em `DEFAULT_PREFERENCES`. Valores salvos inválidos ou
   ausentes caem no padrão (validação por chave), então não há migração.
2. **Web** — `apps/web/src/api/types.ts` (`Preferences`) e
   `apps/web/src/auth/preferences.ts` (`DEFAULT_PREFERENCES`, com o mesmo valor).
3. **Formulário** — um `HpsmField` novo na aba Preferências de
   `apps/web/src/pages/UserPage.tsx`.
4. **Aplicação** — leia com `const { preferences } = useAuth()`. Para gravar fora da
   página de conta, use `updatePreferences({ chave: valor })` (atualiza na hora e
   desfaz se a API recusar).

---

## 7. Verificação visual (Playwright)

Os roteiros em `scripts/ui-playwright/` sobem o **build** do front num Chromium
(Playwright em Docker) e respondem `/api/*` com dados de exemplo — não precisam de
banco nem da API rodando.

| Roteiro | O que faz |
|---|---|
| `screens.mjs` | screenshot de todas as telas em `out/` e medida do cabeçalho da lista |
| `filters.mjs` | troca filtros, busca e Limpar; confere que os filtros sobrevivem a recarregar a página; falha se a tela ficar branca ou a contagem errar |
| `force-password.mjs` | troca obrigatória: login com a temporária abre só "Definir nova senha" (sem shell, sem outras chamadas), outra rota continua nela, validações, igual à temporária recusada, troca entra direto, recarregar pede a temporária, Sair e a pendência na aba Usuários |
| `logout-unsaved.mjs` | Sair com alterações não salvas: pergunta, Continuar editando mantém tela e texto, Sair sem segundo aviso, sem alteração (ou desfeita) sai direto |
| `account.mjs` | login → Página Inicial → menu do usuário → preferências aplicadas → troca de senha (erros e sucesso, botão Salvar do rodapé alinhado aos campos) → novo login |
| `actions.mjs` | diálogo de confirmação (Esc/Não cancelam), redefinir senha, "Registro atualizado." na triagem e aviso de amostra duplicada |
| `unsaved.mjs` | aviso de alterações não salvas: navegador, fechar aba de documento (cancelar mantém a aba), aba interna do relatório e preferências |
| `copy-keyboard.mjs` | botões de copiar (confere a área de transferência) e grade navegável pelo teclado |
| `queues-nav.mjs` | filas com contadores (e atualização após a triagem) e Anterior / Próxima na mesma aba de documento |
| `assign-history.mjs` | Assumir análise, troca de responsável, fila "Atribuídas a mim", coluna/filtro Responsável e aba Histórico (inclui falha do sandbox) |
| `session-idle.mjs` | sessão por inatividade (relógio falso): renovação 1x/min, aviso aos 28 min com contagem, Continuar/Sair, renovação por outra janela e expiração com volta ao login |
| `more-print.mjs` | menu "Mais ▾" (mouse, teclado, Esc devolve o foco), copiar link, nova janela, exportar Markdown (e desabilitado sem relatório) e a ficha impressa (fora da casca, impressão automática, "Impresso por / em", seções, sem dados do sandbox, toolbar oculta no papel, PDF A4) |
| `sla.mjs` | prazo: coluna Idade (formato, laranja/vermelho, "—", dica, leitor de tela), ordenar por idade, filtro Prazo, fila Atrasadas (N), "No status há" na ficha e idade zerada ao mudar o status |
| `comments.mjs` | atualizações na aba Histórico: validação, Ctrl+S, texto puro com quebras de linha, fundo de nota, "Somente atualizações", erro da API, aviso de não salvo; destaque do relatório limpo após salvar |
| `report-review.mjs` | revisão de relatório: fila com contador, situações e ações, devolver com comentário, aviso de devolução, enviar, aprovar, "Ao salvar" com e sem revisão obrigatória, usuário comum só vê publicados, notificação |
| `static-analysis.mjs` | análise estática: aviso de executável disfarçado, tipo real, entropia, PE (empacotador, funções suspeitas, seções, imports), strings por categoria, IOCs sugeridos (ficha e "Inserir" sem duplicar), "Analisar agora", ficha impressa |
| `dashboard.mjs` | painel: indicadores e links, fuso enviado, gráfico (legenda, colunas, dica sem cobrir colunas, tabela), vereditos, carga e link por analista, etiqueta do período na lista, período na URL, escopo do usuário, preferência de página inicial |
| `two-factor.mjs` | 2FA: aba na Minha Conta (desativado, ativar com QR e chave, código incompleto/errado, códigos de recuperação com Baixar), login em duas etapas (código errado, Voltar, certo, recuperação leva à aba com aviso), gerar novos códigos e desativar (senha + código, confirmação) e Desativar 2FA do admin |
| `antivirus.mjs` | antivírus: escaneando → infectado (topo e seção, motor e base), consulta única, Escanear de novo, limpo sem alerta, falha com motivo, sem varredura ("Escanear agora", sem consultar em loop), usuário sem botão, link e ClamAV desligado sem seção |
| `reputation.mjs` | reputação externa: consultando e atualização automática, resumo no topo (malicioso em N de M; sem alertas com falha), nota do indicador, serviços na ordem com cores e resumo, link externo seguro, Consultar de novo só para analistas, seção escondida sem serviço |
| `api-tokens.mjs` | tokens de API: aba da Minha Conta só com liberação, Liberar/Retirar API na aba Usuários (coluna, confirmação), gerar (validação, segredo uma vez, Copiar, aviso limpo), revogar, aba da Administração (ativos/todos, último uso com IP, revogar) e navegador |
| `retention-trash.mjs` | retenção e lixeira: ficha expurgada (resumo, Armazenamento, Baixar desabilitado, análise estática e sandbox indisponíveis, histórico), "Mover para a lixeira" só para admin com confirmação, aba substituída pela Lixeira, busca, Restaurar, Excluir definitivamente e navegador |
| `admin-audit.mjs` | auditoria: aba pelo navegador, colunas, anônimo e cores, paginação, filtros de ação/período/busca, Exportar CSV com os mesmos filtros, lista vazia e Limpar |
| `admin-status.mjs` | status do sistema: aba pelo navegador, rótulos e cores por situação, resumo/tempo/detalhes, linha com falha destacada, aviso geral e Atualizar |
| `duplicates.mjs` | duplicatas: caixa com sugestões e foco, ID inválido (erro e foco), Esc, marcar (resumo, histórico, marca na grade, seção na principal), desfazer com confirmação, oculto para usuário comum |
| `report-templates.mjs` | modelos: aba pelo navegador, validação, criar (Ctrl+S), editar, nome repetido da API no campo, excluir com confirmação; campo Modelo no Novo relatório (preenche, veredito, pergunta antes de sobrescrever) |
| `notifications.mjs` | caixa de entrada: contador no sininho e no navegador, painel (frases, foco, teclado, abrir marca como lida, marcar todas), página com filtro e teclado; menções (lista, Esc, Enter/Tab, nova linha, ids enviados, destaque no histórico) |
| `iocs.mjs` | indicadores: seção na aba Relatórios, ficha (título, resumo, onde aparece, aba de documento, teclado), ficha vazia/inválida, "Ir para:" com IOC desarmado/IP/IP privado/texto, links nas Relacionadas e exportação CSV/STIX/MISP |
| `related.mjs` | aba Relacionadas: total no rótulo, coluna Motivo (vários motivos, singular/plural, IOCs em comum com hash encurtado, "+N" e lista na dica), rodapé com o limite, setas + Enter, Anterior/Próxima pelas relacionadas, lista vazia |
| `favorites.mjs` | Favoritos: Salvar visão (nome sugerido, sem a página, repetida, limite de 30), Fixar/Desafixar, abrir e destacar pelo navegador, menu de contexto (mover, renomear), Shift+F10, F2, Delete e "×" |
| `shortcuts-help.mjs` | ajuda de atalhos: `?` (texto dentro de campos), F1 (em qualquer lugar, sem a ajuda do navegador), Esc/Fechar, foco devolvido, menu do usuário e Dicas vindas da mesma lista |
| `validation-api.mjs` | formulário de chave do Admin (validação, Ctrl+S, números enviados) e erros por campo da API em chave, envio de URL, relatório, atualização, troca de senha e cadastro (destaque, mensagem, foco, some ao corrigir) |
| `validation.mjs` | validação: destaque vermelho (cor conferida, também com foco), mensagem, foco no 1º inválido e destaque que some ao corrigir |
| `api-down.mjs` | API fora do ar ou subindo: o nginx devolve 502 em HTML e o login mostra "A API não respondeu (erro 502)…" em vez do erro de JSON; com a API de volta, entra |
| `cases.mjs` | casos: pasta com contadores, caso novo pela ficha (título curto, aviso, topo), marcadas num caso existente, lista e folha ativa, tela (Ctrl+S, incluir por link, retirar com confirmação, comentário, linha do tempo), última amostra não sai, usuário comum sem acesso |
| `email.mjs` | e-mail: cabeçalhos, Responder para de outro domínio, SPF/DKIM/DMARC com cores, caminho em ordem, links só como texto, corpo sem HTML, anexos (link e ignorado), IOCs sugeridos com links e domínios, "Anexo de" na filha |
| `kb.mjs` | base de conhecimento: navegador, novo artigo (obrigatórios, pré-visualização: título, ênfase, lista, URL solta sem link, só http(s)/internos, HTML como texto), Ctrl+S, leitura e aba, editar (PATCH, alterações), busca e categoria, citações, "Ir para:" pelo título e `kb:`, campo do relatório e links, excluir, usuário comum só lê |
| `quota.mjs` | cota de envio: analista sem aviso, "Restam N envios" (e singular), 429 da API, esgotada com horário local e botão desabilitado |
| `team-views.mjs` | visões da equipe: pasta com contador e autor, sem menu para quem não pode, abrir e destacar, Compartilhar visão (nome sugerido, envio, aviso), repetida, renomear pelo menu, remover pelo Delete com confirmação, sem botão fora do Histórico Global, usuário comum sem pasta e sem consulta |
| `compare.mjs` | comparar: "Comparar as 2" só com duas marcadas, lado a lado (difere destacado, linhas vazias escondidas, link), listas só com itens (contagens, tipo do IOC), trocar os lados, mesmo conteúdo, "Comparar com…" da ficha (mesma amostra recusada, ID), inexistente, sem parâmetros, usuário comum sem acesso |
| `attack.mjs` | ATT&CK: topo da ficha e relatório com links, campo do relatório (busca por nome e código, setas + Enter, clique, ordem do ATT&CK, ×, Backspace, envio), link → Histórico filtrado, filtro (trocar, código incompleto, apagar, Limpar), etiqueta em Meus Uploads, quadro do Painel (barras proporcionais, link, vazio) |
| `document.mjs` | análise de documento: aviso no topo com risco alto, seção com risco, alertas coloridos, links só como texto, objeto embutido, macro (roda ao abrir, suspeitas, "Ver código" como texto), documento limpo, não documento sem seção |
| `similar.mjs` | arquivos parecidos (TLSH): motivo com a %, filtro de similaridade (vai para a API, lista vazia mantém o filtro, Limpar volta a 70%), contador da aba no padrão, TLSH "T1…" na ficha com Copiar, "Não calculável" e "Calculando…" |
| `sla-escalation.mjs` | escalonamento por prazo: avisos de alerta/atraso no painel do sininho (sem trecho, abre a ficha) e na página Caixa de entrada; histórico com autor Sistema, prazo e prioridade, prioridade subida "por atraso" |
| `case-export.mjs` | exportar o caso: seção Indicadores das amostras (links, URL como texto), menu Exportar (Markdown com dados, amostras, relatórios, indicadores, técnicas e linha do tempo; IOCs CSV/STIX pela API), Imprimir (fora da casca, automática, seções, PDF), caso sem indicadores |
| `report-versions.mjs` | versões do relatório: Editar (preenchido, Cancelar, resumo obrigatório, Ctrl+S salva a edição e não cria outro), Versões (N) com a diferença (+/−, linha adicionada, veredito, ATT&CK), versões iguais, ocultar, sem Editar com revisão obrigatória, usuário comum sem ações |
| `evidence.mjs` | evidências: miniaturas e legendas, ampliada (setas, Esc, foco de volta), envio com legenda, SVG recusado com o motivo, legenda e exclusão, imagens na ficha impressa, revisão obrigatória e usuário comum só veem |
| `management.mjs` | relatório gerencial: pasta Gestão, padrão de 30 dias com o fuso, indicadores, tempo por prioridade (dias acima de 48 h), carga por analista, mês anterior e data livre na URL, CSV, impressão automática com o período, usuário comum sem acesso |
| `ioc-import.mjs` | importar indicadores: pela Minha Conta (seguir) e pelos permitidos, foco, pré-visualização com resumo, situação e inválidos, importa só os novos, arquivo, erro de leitura, Esc, motivo obrigatório nos permitidos |
| `assignment.mjs` | atribuição automática: pasta Gestão, regras (ordem, desligada apagada, descer, ligar, incluir sem grupo/com campos, excluir), grupos (ausente marcado, grupo vazio, membros, criar, excluir com aviso), disponibilidade (admin e analista), histórico "automática: grupo…", usuário comum sem acesso |
| `capture.mjs` | captura da página: seção só em links, capturar (em andamento → concluída por consulta), print, endereço final como texto, redirecionamentos, certificado, bloqueados, HTML só para baixar, falha com motivo, anteriores, histórico, desligada, usuário comum só vê |
| `script.mjs` | análise de script: aviso no topo, seção com linguagem e risco, achados com o porquê e a camada, URL só como texto, camada decodificada como texto puro (sem executar HTML), ocultar, benigno sem aviso, arquivo sem script sem seção |
| `decoder.mjs` | decodificador: Ctrl+Shift+D (vazio e com seleção), menu Mais, foco, PowerShell -EncodedCommand, sugestões, hex + XOR, erro marcado no passo, Base64 + gzip, aba Hex, Copiar, resultado como texto, Esc, camada do script, atalho na lista |
| `disk.mjs` | atalho e imagem de disco: aviso, seção do .lnk (texto puro, Copiar do comando, janela minimizada, máquina/MAC, alertas), imagem (formato, rótulo, ocultos, alertas), extrair com confirmação, linhas ligadas às filhas, VHDX não listado, "Extraído de", usuário comum sem extrair |
| `triage-rules.mjs` | regras de triagem: pasta Detecção, lista (condição, tags, prioridade, desligada apagada), valor só quando a condição pede, validação, incluir, ligar, excluir com aviso, histórico da regra, usuário comum sem acesso |
| `smoke.mjs` | teste rápido contra a API real (`npm run test:smoke`, fora do `run.ps1`): primeiro acesso, envio com análise, abas da ficha, triagem em massa conferida na API, telas do admin, cadastro com chave, telas do usuário comum e as que ele não abre, amostra de outra pessoa, sair; reprova com erro inesperado da API, no console ou da CSP |
| `long-names.mjs` | nome longo e tela estreita: 390 px sem rolar de lado (admin e usuário comum), aba ativa à vista sem mexer na página, muitas abas, nome de 200 caracteres sem espaço na lista (colunas à vista, duas linhas, nome inteiro no `title`) e na ficha |
| `upload-feedback.mjs` | envio: limite real na ajuda, arquivo maior recusado sem chamar a API (nome no aviso), queda de rede em português com o arquivo mantido, 413 e 503 com a mensagem da API |
| `navigation-a11y.mjs` | título da aba do navegador (tela, amostra, ao sair), primeiro Tab é "Pular para o conteúdo" e leva ao conteúdo, menu no celular (estado no botão, foco entra, Esc fecha e devolve o foco, sem foco com ele fechado) |
| `sidebar-folders.mjs` | pastas do Navegador: recolher e abrir gravam uma vez por sequência de cliques, voltam depois de recarregar e em nova sessão, Salvar e Restaurar padrões das Preferências não mexem, falha ao gravar não atrapalha |
| `plain-language.mjs` | usuário comum: situação em linguagem simples na ficha (por status e veredito, com aviso só para quem enviou, resolução no lugar quando há), "Arquivo" recolhido, "Cliquei ou abri, e agora?" sem atalhos; analista sem mudanças; lista vazia diferente de filtro sem resultado; Enter envia e não quebra a descrição |
| `sample-access.mjs` | acesso às amostras: analista baixa e vê o e-mail; usuário comum sem "Baixar amostra" na de outra pessoa e só com o nome (ficha e impressão), baixa a própria; filtro "Amostra baixada" na auditoria |
| `ldap-login.mjs` | login pelo AD: sem AD igual a antes; com AD, "E-mail ou usuário da rede" (campo texto) e explicação, envia o usuário da rede; conta do AD sem troca de senha; Administração com a marcação "AD" e sem redefinir a senha |
| `backup.mjs` | backup: pasta Administração, lista (pronto, falha com motivo, vencido apagado, malware marcado), gerar com amostras com confirmação, progresso até pronto, um por vez, Baixar, excluir com confirmação |
| `api-docs.mjs` | documentação da API: link na aba Tokens, exemplos em curl com o endereço e Copiar, rotas da especificação (método, caminho, campos com tipo e obrigatório, respostas), baixar o `openapi.json`, nada que chame a API, aviso sem acesso liberado |
| `lookalike.mjs` | domínios parecidos: aviso na ficha (domínio, motivo, onde, texto puro), sem achados sem aviso, pasta Detecção, variações vistas (motivo, onde, amostras com veredito e "+N"), incluir (obrigatório, erro da API no campo, Enter), excluir com confirmação, analista só vê, usuário comum sem a tela |
| `relation-map.mjs` | mapa de relações: aba Mapa, nós por tipo, cor pelo veredito, rótulo da ligação, "+N", descrição para leitores de tela, lista equivalente (grupos, motivos, links), Expandir pelo teclado sem mexer no que já estava, clicar abre indicador/ficha, mapa vazio, mapa do caso, usuário comum |
| `case-notifications.mjs` | menções e avisos nos casos: "@" só com analistas, inserir, enviar só quem continua no texto, menção destacada na linha do tempo, Caixa de entrada (menção, comentário, incluídas, retirada, atribuição, coluna "Amostra ou caso"), abrir leva ao caso, sininho |
| `resolution.mjs` | resolução para quem enviou: modelos que se somam, contador, alteração não salva, salvar aparado, destaque no topo (cor pelo veredito, texto puro), histórico, remover, Meus Uploads, caixa de entrada e sininho (aviso de resolução e de concluída), quem enviou vê sem o campo |
| `broadcasts.mjs` | avisos gerais: faixa (alerta primeiro, caso, autor, validade), dispensar só aquele, Página Inicial, pasta Gestão, lista com dispensas, texto obrigatório, publicar, limite de 3, encerrar com confirmação, usuário comum vê a faixa sem a gestão |
| `search.mjs` | busca: navegador, mínimo de caracteres, termo na URL, grupos com contagem, trecho destacado sem HTML, links, "Ver todos", período, nada encontrado, "Ir para:" com texto livre, usuário comum sem Casos |
| `allowlist.mjs` | indicadores permitidos: navegador, obrigatórios, faixa inválida com dica, Ctrl+S, repetido, ficha marcada com o motivo, IOCs sugeridos sem os permitidos (contagem dos ocultos), remover com confirmação, usuário comum sem acesso |
| `yara-retro.mjs` | YARA retroativo: confirmação, aviso com o total, progresso que atualiza sozinho (barra, ilegíveis, acima do limite), acertos com link e identificadores, botões desabilitados durante a varredura, cancelar, concluída sem acertos |
| `yara.mjs` | regras YARA: item só para analistas no navegador, obrigatórios, Validar com erro (quadro do compilador com a linha), salvar recusado com o campo destacado, validar ok, Ctrl+S, nome em uso, editar (PATCH), desativar (só `enabled`), excluir com confirmação; ficha escaneando → acertos (tabela e topo), Escanear de novo, sem regras sem seção; usuário comum redirecionado |
| `ioc-watch.mjs` | alertas de IOC: Seguir/Deixar de seguir na ficha do indicador, aba Indicadores na Minha Conta (link, deixar de seguir) e notificação com texto e link para a aba Relatórios |
| `sessions.mjs` | sessões: aba na Minha Conta, atual marcada sem ação, User-Agent na dica, encerrar uma (confirmação com dispositivo e IP), encerrar as outras e botão desabilitado sem outras |
| `priority.mjs` | prioridade: coluna e prazo pela prioridade (P1 de 5 h atrasada, P3 de 5 h no prazo, dica), filtro, ordenação (mais urgente primeiro), atualização em massa, ficha (resumo, triagem com o prazo) e histórico |
| `hex-viewer.mjs` | visualizador hexadecimal: carrega sob demanda, linha offset/hex/texto, cabeçalho MZ destacado, Mostrar mais até o fim, expurgado, link e usuário comum sem a seção |
| `take-next.mjs` | "Pegar a próxima": botão na fila Pendentes e link na Página Inicial abrem a ficha pega; fila vazia avisa e fica na lista; usuário comum sem botão |
| `password-policy.mjs` | política de senha: regra no cadastro e em Alterar senha (barra antes de enviar), validade na aba Senha (e "sem validade" para admin), aviso "Sua senha expira em N dias" no topo (e "hoje") com link, "senha expirada" na aba Usuários e a tela de senha vencida com o motivo e a regra |
| `topbar-center.mjs` | "Ir para:" centralizado no masthead em 1440/1024/900 px (centro horizontal, meio da altura, sem encostar no logo nem no usuário) e fora do masthead em tela estreita |
| `quick-search.mjs` | "Ir para:" do masthead: Ctrl+K, SHA-256 abre a amostra, hash desconhecido e texto abrem a lista filtrada |
| `bulk-update.mjs` | atualização em massa: seleção, barra, confirmação, resultado, limpeza ao filtrar, Espaço/Enter e usuário comum sem a coluna |
| `detail-pane.mjs` | painel de detalhe: desligado o clique abre; ligado, seleção, setas, duplo clique, Enter e "Abrir amostra" |
| `news-shortcuts-export.mjs` | novidades na Página Inicial, atalhos (`/`, Alt+N, Alt+W, Ctrl+S) e download do CSV com os filtros |
| `batch-upload.mjs` | envio em lote: soma sem repetir, total, Remover, limite de 20, título some, um envio por arquivo com descrição e tags, resultado (falha, "já enviada antes", link), `.zip` com Desmembrar, senha errada no campo e resultado com ignorados |
| `filedrop-sandbox.mjs` | arrastar e soltar o arquivo (via `DataTransfer`) e prazo do sandbox: aba com "Nmin", aviso nos últimos 5 min e "Estender prazo" |
| `mock-api.mjs` | API simulada e servidor do `dist` usados pelos três |

```powershell
cd apps/web; npm run build; cd ../..
powershell -ExecutionPolicy Bypass -File scripts/ui-playwright/run.ps1
# só alguns roteiros:
powershell -ExecutionPolicy Bypass -File scripts/ui-playwright/run.ps1 -Scripts filters,account
```

Requer o Docker em execução (imagem `mcr.microsoft.com/playwright:v1.64.1-noble`).
O script sai com erro se alguma checagem falhar; screenshots ficam em
`scripts/ui-playwright/out/` (ignorado pelo git).

---

## 8. Próximas melhorias

Ideias de UX/usabilidade priorizadas estão em [`docs/ux-backlog.md`](ux-backlog.md):
a primeira leva (1–18) está implementada; a segunda (19–30, padrões do HPSM 9 como
painel de detalhe, atualização em massa e Favoritos) está pendente.
