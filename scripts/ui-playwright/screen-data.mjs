// Dados das telas para a varredura visual (sweep.mjs) e para a suite visual (scripts/ui-visual):
// o que a API simulada nao traz pronto. Duas partes:
// - seedRecords: caso, artigo da KB e ambiente isolado no estado do mock;
// - installScreenRoutes: rotas so de leitura das telas que os cenarios dedicados simulam por conta
//   propria (backup, atribuicao, avisos gerais, dominios da empresa).
// Tudo fixo, para o print sair igual entre rodadas. `now` e o instante de referencia (o relogio
// congelado da suite visual); sem ele, o relogio real.
import { entries, runningSandbox } from './mock-api.mjs';

const ana = { id: 'u1', displayName: 'Ana Souza' };
const bruno = { id: 'u2', displayName: 'Bruno Lima' };
const iso = (ms) => new Date(ms).toISOString();

/** Caso com duas amostras, artigo da KB, ambiente isolado em execucao (40 min de prazo) e as
 *  listas da comparacao de amostras (as do cenario compare.mjs). */
export function seedRecords(state, { now = Date.now() } = {}) {
  const at = '2026-10-24T09:00:00.000Z';
  const e1 = entries.find((e) => e.id === 'e1');
  const e2 = entries.find((e) => e.id === 'e2');
  const ce = (e, reports = []) => ({
    addedAt: at,
    addedBy: ana,
    entry: { id: e.id, title: e.title, type: e.type, status: e.status, verdict: e.verdict, priority: 'P3', createdAt: e.createdAt, sha256: e.sha256 ?? null, url: e.url ?? null, reports },
  });
  const event = (id, type, extra = {}) => ({ id, type, detail: null, fromValue: null, toValue: null, createdAt: at, actor: ana, entry: null, ...extra });
  state.cases = [
    {
      id: 'cs1', number: 1, code: 'CASO-0001', title: 'Campanha do boleto', description: 'Phishing com instalador.', status: 'IN_PROGRESS',
      createdAt: at, updatedAt: at, closedAt: null, assignee: ana, createdBy: ana,
      entries: [
        ce(e1, [{ id: 'r1', summary: 'Baixa o segundo estágio.', findings: 'Persiste via chave Run.', iocs: 'updater-cdn.example\n185.0.2.10', verdict: 'MALICIOUS', updatedAt: at, analyst: bruno, attackTechniques: ['T1059.001'], evidence: [] }]),
        ce(e2),
      ],
      events: [event('ev1', 'CREATED', { detail: 'Campanha do boleto' }), event('ev3', 'COMMENT', { detail: 'Mesmo remetente nas duas.' })],
    },
  ];
  state.caseIocs.cs1 = [
    { kind: 'SHA256', value: e1.sha256, source: 'SAMPLE', entries: [{ id: 'e1', title: e1.title, verdict: e1.verdict }] },
    { kind: 'IPV4', value: '185.0.2.10', source: 'REPORT', entries: [{ id: 'e1', title: e1.title, verdict: e1.verdict }] },
  ];
  state.kbArticles.push({
    id: 'kb2', title: 'Golpe do falso boleto', summary: 'Boleto adulterado.', category: 'SCAM', tags: ['boleto'], body: 'Confira o beneficiário.',
    createdAt: '2026-10-20T10:00:00.000Z', updatedAt: '2026-10-20T10:00:00.000Z', createdBy: bruno, updatedBy: bruno,
    canDelete: false, revisions: [], reports: [], citations: 1,
  });
  state.sandboxes.e1 = { ...runningSandbox('e1', 40), expiresAt: iso(now + 40 * 60_000) };
  state.compareLists = {
    urls: { common: ['http://shared.test/x'], onlyA: ['http://c2.evil.test/a', 'http://c2.evil.test/b'], onlyB: [] },
    iocs: { common: ['IPV4:185.199.1.7'], onlyA: ['DOMAIN:c2.evil.test'], onlyB: ['SHA256:' + 'b'.repeat(64)] },
    attack: { common: [], onlyA: ['T1566.001 Spearphishing Attachment'], onlyB: ['T1486 Data Encrypted for Impact'] },
  };
}

/** Rotas so de leitura (GET) das telas com dados proprios; escrita responde 405. */
export async function installScreenRoutes(context, { now = Date.now() } = {}) {
  const json = (route, data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
  const readOnly = (handler) => async (route) => {
    if (route.request().method() !== 'GET') return json(route, { error: 'Somente leitura nesta captura.' }, 405);
    return handler(route, new URL(route.request().url()).pathname);
  };

  // Backup: tres ZIPs (pronto com e sem amostras, vencido) e o agendamento salvo (seg, qua, sex).
  const manifest = { version: '1.0.0', containsMalware: false, fileCount: 12, counts: { entries: 40, reports: 18, users: 6, cases: 3, objects: 9 } };
  const backups = [
    { id: 'b3', status: 'READY', includeSamples: true, encrypted: true, step: null, progress: 100, size: 2097152, manifest: { ...manifest, containsMalware: true }, error: null, createdAt: '2026-10-19T10:00:00.000Z', finishedAt: '2026-10-19T10:01:00.000Z', expiresAt: '2026-10-26T10:01:00.000Z', createdBy: ana },
    { id: 'b2', status: 'READY', includeSamples: false, encrypted: true, step: null, progress: 100, size: 52428800, manifest, error: null, createdAt: '2026-10-18T09:00:00.000Z', finishedAt: '2026-10-18T09:02:00.000Z', expiresAt: '2026-10-25T09:02:00.000Z', createdBy: ana },
    { id: 'b0', status: 'EXPIRED', includeSamples: true, encrypted: false, step: null, progress: 100, size: 1048576, manifest: { ...manifest, containsMalware: true }, error: null, createdAt: '2026-10-01T09:00:00.000Z', finishedAt: '2026-10-01T09:01:00.000Z', expiresAt: '2026-10-08T09:01:00.000Z', createdBy: ana },
  ];
  const schedule = {
    schedule: { enabled: true, mode: 'weekly', days: [1, 3, 5], dayOfMonth: 1, time: '02:00', timezone: 'America/Sao_Paulo', nextRunAt: '2026-10-21T05:00:00.000Z', lastRunAt: '2026-10-19T05:00:00.000Z' },
    summary: 'seg, qua e sex às 02:00 (America/Sao_Paulo)',
    passwordConfigured: true,
    destination: 'bucket',
  };
  await context.route((url) => url.pathname.startsWith('/api/admin/backups'), readOnly((route, path) =>
    path === '/api/admin/backups/schedule' ? json(route, schedule) : json(route, { items: backups, retentionDays: 7, destination: 'bucket', destinationProblem: null }),
  ));

  // Atribuicao automatica: dois grupos, duas regras (uma desligada), um analista ausente.
  const away = { u1: false, u2: true };
  const member = (p) => ({ ...p, away: away[p.id], available: !away[p.id], lastAssignedAt: null });
  await context.route((url) => url.pathname.startsWith('/api/assignment'), readOnly((route) => json(route, {
    groups: [
      { id: 'g2', name: 'Malware', rules: 1, members: [] },
      { id: 'g1', name: 'Phishing', rules: 1, members: [member(ana), member(bruno)] },
    ],
    rules: [
      { id: 'r1', groupId: 'g1', entryType: 'URL', tag: 'phishing', priority: null, enabled: true, position: 1, label: 'tipo link, tag phishing', group: { id: 'g1', name: 'Phishing' } },
      { id: 'r2', groupId: 'g2', entryType: 'FILE', tag: null, priority: null, enabled: false, position: 2, label: 'tipo arquivo', group: { id: 'g2', name: 'Malware' } },
    ],
    analysts: [ana, bruno].map((p) => ({ ...p, away: away[p.id] })),
  })));

  // Avisos gerais: a lista da tela de gestao. Os ativos ficam vazios: a faixa do topo apareceria
  // em todas as telas da captura.
  const tomorrow = iso(now + 24 * 3600_000);
  const broadcasts = [
    { id: 'b1', text: 'Campanha do boleto vencido em andamento. Não abra anexos de cobrança.', level: 'WARNING', startsAt: '2026-10-19T08:00:00.000Z', expiresAt: tomorrow, createdAt: '2026-10-19T08:00:00.000Z', createdBy: bruno, case: { id: 'cs1', number: 1, title: 'Campanha do boleto', code: 'CASO-0001' }, active: true, _count: { dismissals: 3 } },
    { id: 'b2', text: 'Manutenção do e-mail hoje à noite.', level: 'INFO', startsAt: '2026-10-19T09:00:00.000Z', expiresAt: tomorrow, createdAt: '2026-10-19T09:00:00.000Z', createdBy: ana, case: null, active: true, _count: { dismissals: 0 } },
  ];
  await context.route((url) => url.pathname.startsWith('/api/broadcasts'), readOnly((route, path) =>
    json(route, { items: path === '/api/broadcasts/active' ? [] : broadcasts }),
  ));

  // Dominios da empresa e as variacoes vistas.
  await context.route((url) => url.pathname.startsWith('/api/company-domains'), readOnly((route) => json(route, {
    domains: [
      { id: 'cd1', domain: 'empresa.com.br', createdAt: '2026-10-15T10:00:00.000Z', createdBy: ana },
      { id: 'cd2', domain: 'empresa.com', createdAt: '2026-10-15T10:05:00.000Z', createdBy: ana },
    ],
    seen: [
      { domain: 'ernpresa.com.br', companyDomain: 'empresa.com.br', reason: 'HOMOGLYPH', label: 'letras parecidas', detail: null, sources: ['URL', 'LINK'], total: 7, lastSeen: '2026-10-19T10:00:00.000Z', entries: [{ id: 'e2', title: 'Página de login falsa do banco', verdict: 'MALICIOUS' }, { id: 'e1', title: 'instalador_suspeito.exe', verdict: 'SUSPICIOUS' }] },
      { domain: 'empreza.com.br', companyDomain: 'empresa.com.br', reason: 'TYPO', label: 'erro de digitação', detail: 'letra trocada', sources: ['IOC'], total: 1, lastSeen: '2026-10-18T10:00:00.000Z', entries: [{ id: 'e4', title: 'driver_update.msi', verdict: 'CLEAN' }] },
    ],
    max: 20,
  })));
}
