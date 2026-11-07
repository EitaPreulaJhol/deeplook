// Backup em ZIP (81): aba Backup da Administracao (e folha no navegador), lista
// (situacao, conteudo, tamanho, validade, motivo da falha, vencido apagado),
// gerar sem e com amostras (confirmacao de malware), progresso acompanhado ate
// ficar pronto, um por vez, Baixar e Excluir com confirmacao.
import { chromium } from 'playwright';

import { createState, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const state = createState({ loggedIn: true });
await setupMock(context, state);
const ana = { id: 'u1', displayName: 'Ana Souza' };
const manifest = { version: '1.0.0', containsMalware: false, fileCount: 12, counts: { entries: 40, reports: 18, users: 6, cases: 3, objects: 9 } };
const items = [
  { id: 'b2', status: 'READY', includeSamples: false, encrypted: true, step: null, progress: 100, size: 52428800, manifest, error: null, createdAt: '2026-10-28T09:00:00.000Z', finishedAt: '2026-10-28T09:02:00.000Z', expiresAt: '2026-11-04T09:02:00.000Z', createdBy: ana },
  { id: 'b1', status: 'FAILED', includeSamples: false, step: null, progress: 2, size: null, manifest: null, error: 'pg_dump falhou (1): connection refused', createdAt: '2026-10-27T09:00:00.000Z', finishedAt: '2026-10-27T09:00:05.000Z', expiresAt: null, createdBy: ana },
  { id: 'b0', status: 'EXPIRED', includeSamples: true, step: null, progress: 100, size: 1048576, manifest: { ...manifest, containsMalware: true }, error: null, createdAt: '2026-10-10T09:00:00.000Z', finishedAt: '2026-10-10T09:01:00.000Z', expiresAt: '2026-10-17T09:01:00.000Z', createdBy: ana },
];
const calls = [];
let polls = 0;
// Destino dos ZIPs (item 6.13): o bucket, ou a pasta BACKUP_DIR e o que a impede de gravar.
let destination = { destination: 'bucket', destinationProblem: null };
// Agendamento (item 6.13): a senha do .env existe? E o que foi salvo.
let schedule = { schedule: null, summary: null, passwordConfigured: false, destination: 'bucket' };
await context.route((url) => url.pathname.startsWith('/api/admin/backups'), async (route) => {
  const req = route.request();
  const path = new URL(req.url()).pathname;
  const json = (status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
  if (path === '/api/admin/backups/schedule') {
    if (req.method() === 'PUT') {
      const body = JSON.parse(req.postData());
      calls.push({ method: 'PUT', path, body });
      schedule = { ...schedule, schedule: { ...body, nextRunAt: '2026-11-09T05:00:00.000Z', lastRunAt: null }, summary: 'seg, qua, sex às 02:00 (America/Sao_Paulo)' };
    }
    return json(200, schedule);
  }
  if (req.method() === 'GET' && path === '/api/admin/backups') {
    const running = items.find((b) => b.status === 'RUNNING');
    if (running) {
      polls += 1;
      if (polls === 1) Object.assign(running, { step: 'Copiando os arquivos (3 de 9)...', progress: 47 });
      if (polls >= 3) Object.assign(running, { status: 'READY', step: null, progress: 100, size: 2097152, manifest: { ...manifest, containsMalware: true }, expiresAt: '2026-11-05T10:00:00.000Z' });
    }
    return json(200, { items, retentionDays: 7, ...destination });
  }
  if (req.method() === 'GET' && path.endsWith('/download')) {
    calls.push({ method: 'GET', path });
    return route.fulfill({ status: 200, headers: { 'content-type': 'application/zip', 'content-disposition': 'attachment; filename="deeplook-backup.zip"' }, body: 'PK' });
  }
  const body = req.postData() ? JSON.parse(req.postData()) : null;
  calls.push({ method: req.method(), path, body });
  if (req.method() === 'POST') {
    if (items.some((b) => b.status === 'RUNNING')) return json(409, { error: 'Já há um backup em andamento. Aguarde terminar.' });
    const item = { id: 'b3', status: 'RUNNING', includeSamples: body.includeSamples, encrypted: Boolean(body.password), step: 'Exportando o banco...', progress: 2, size: null, manifest: null, error: null, createdAt: '2026-10-29T10:00:00.000Z', finishedAt: null, expiresAt: null, createdBy: ana };
    items.unshift(item);
    return json(202, { item });
  }
  items.splice(items.findIndex((b) => path.endsWith(`/${b.id}`)), 1);
  return json(200, { ok: true });
});
const page = await context.newPage();
watchErrors(page);

let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};
const settle = (ms = 400) => page.waitForTimeout(ms);
const rows = () => page.locator('table[aria-label="Backups"] tbody tr');
const rowText = async (i) => (await rows().nth(i).innerText()).replace(/\s+/g, ' ');
const msgs = async () => (await page.locator('.hpsm-msg__text').allInnerTexts()).join(' | ');
const dlg = page.locator('[role=alertdialog]');

// 1. Pelo navegador.
await page.goto(ORIGIN + '/inicio', { waitUntil: 'networkidle' });
await page.click('#hpsm-tree-admin .hpsm-tree__leaf:has-text("Backup")');
await settle();
expect('abre a aba Backup', new URL(page.url()).search === '?tab=backup' && (await page.locator('[role=tab][aria-selected=true]').innerText()).trim() === 'Backup');

// 2. Lista.
expect('três backups', (await rows().count()) === 3);
const ready = await rowText(0);
expect('pronto com conteúdo, tamanho e validade', ready.includes('Pronto') && ready.includes('com senha') && ready.includes('sem as amostras') && ready.includes('40 amostra(s), 18 relatório(s), 9 arquivo(s) · versão 1.0.0') && ready.includes('50.0 MB') && ready.includes('04/11/2026'), ready);
expect('Baixar só no pronto', (await rows().nth(0).locator('a:has-text("Baixar")').getAttribute('href')) === '/api/admin/backups/b2/download' && (await rows().nth(1).locator('a:has-text("Baixar")').count()) === 0);
expect('falha com o motivo', (await rowText(1)).includes('Falhou') && (await rowText(1)).includes('pg_dump falhou (1): connection refused'));
expect('vencido apagado e marcado malware', (await rows().nth(2).getAttribute('class')).includes('is-off') && (await rowText(2)).includes('com as amostras (malware)'));

// 3. Senha do ZIP: obrigatoria, salvo a opcao de exportar sem ela.
const generate = 'button.dl-btn:has-text("Gerar backup")';
await page.click(generate);
await settle(200);
expect('sem senha não gera', !calls.some((c) => c.method === 'POST') && (await msgs()).includes('12 caracteres'), await msgs());
await page.fill('#backup-password', 'Senha-Do-Zip-123');
await page.fill('#backup-password-again', 'Outra-Senha-Do-Zip');
await page.click(generate);
await settle(200);
expect('senhas diferentes não geram', !calls.some((c) => c.method === 'POST') && (await msgs()).includes('não conferem'), await msgs());
await page.click('label[for="backup-no-password"]');
await settle(100);
expect('sem senha: campos somem', (await page.locator('#backup-password').count()) === 0);
await page.click('label[for="backup-samples"]');
await page.click(generate);
await settle(300);
const riskText = await dlg.innerText();
expect('confirma os dois riscos', riskText.includes('malware real') && riskText.includes('segredos de 2FA'), riskText);
await dlg.locator('button:has-text("Cancelar")').click();
await settle(200);
expect('cancelar não gera', !calls.some((c) => c.method === 'POST'));
await page.click('label[for="backup-no-password"]');
await settle(100);
await page.fill('#backup-password', 'Senha-Do-Zip-123');
await page.fill('#backup-password-again', 'Senha-Do-Zip-123');
await page.click(generate);
await settle(300);
const risk2 = await dlg.innerText();
expect('com senha: só o risco das amostras', risk2.includes('malware real') && !risk2.includes('2FA'), risk2);
await dlg.locator('button:has-text("Gerar")').click();
await settle(300);
expect('gera com a senha', JSON.stringify(calls.find((c) => c.method === 'POST')?.body) === JSON.stringify({ includeSamples: true, password: 'Senha-Do-Zip-123' }), JSON.stringify(calls.find((c) => c.method === 'POST')?.body));
expect('aviso de início', (await msgs()).includes('Backup iniciado'), await msgs());
expect('campos limpos depois de gerar', (await page.inputValue('#backup-password')) === '');

// 4. Progresso ate ficar pronto; um por vez.
expect('botão travado enquanto gera', await page.locator('button.dl-btn:has-text("Gerar backup")').isDisabled());
await page.waitForFunction(() => document.querySelector('.dl-backup__running')?.textContent?.includes('Copiando os arquivos (3 de 9)'), null, { timeout: 8000 });
expect('mostra a etapa e o percentual', (await page.locator('.dl-backup__running').innerText()).includes('47%'));
await page.screenshot({ path: `${OUT}/backup-gerando.png`, fullPage: true });
await page.waitForFunction(() => !document.querySelector('.dl-backup__running'), null, { timeout: 10000 });
const fresh = await rowText(0);
expect('fica pronto sozinho', fresh.includes('Pronto') && fresh.includes('com as amostras (malware)') && fresh.includes('2.0 MB'), fresh);
expect('botão liberado de novo', !(await page.locator('button.dl-btn:has-text("Gerar backup")').isDisabled()));
await page.screenshot({ path: `${OUT}/backup-lista.png`, fullPage: true });

// 5. Excluir com confirmacao.
await rows().nth(2).locator('button:has-text("Excluir")').click();
await settle(300);
expect('confirma a exclusão', (await dlg.innerText()).includes('O ZIP sai do servidor'));
await dlg.locator('button:has-text("Excluir")').click();
await settle();
expect('excluído', calls.at(-1)?.method === 'DELETE' && calls.at(-1)?.path === '/api/admin/backups/b1' && (await rows().count()) === 3);

// 6. Destino: no bucket avisa do mesmo disco; na pasta, mostra o que impede de gravar.
const intro = async () => (await page.locator('.dl-backup__intro').allInnerTexts()).join(' ');
expect('no bucket: avisa do mesmo disco e do BACKUP_DIR', (await intro()).includes('mesmo disco dos dados') && (await intro()).includes('BACKUP_DIR'));
destination = { destination: 'dir', destinationProblem: 'A pasta de backup não tem o arquivo .deeplook-backups: o disco pode não estar montado.' };
await page.reload({ waitUntil: 'networkidle' });
await settle();
expect('na pasta: diz onde e cita o .sha256', (await intro()).includes('pasta de backup do servidor') && (await intro()).includes('.sha256'));
expect('na pasta com problema: mostra o motivo', (await msgs()).includes('.deeplook-backups'), await msgs());

// 7. Agendamento com calendario.
const enabled = page.locator('#schedule-enabled');
expect('sem a senha do .env: avisa e não liga', (await msgs()).includes('BACKUP_SCHEDULE_PASSWORD') && (await enabled.isDisabled()));
schedule = { ...schedule, passwordConfigured: true };
await page.reload({ waitUntil: 'networkidle' });
await settle();
expect('com a senha: liga', !(await enabled.isDisabled()));
await page.locator('label[for="schedule-enabled"]').click();
// Padrao: dias uteis. Fica seg, qua e sex.
for (const day of [2, 4]) await page.locator(`label[for="schedule-day-${day}"]`).click();
await page.fill('#schedule-time', '02:00');
await settle(200);
const marked = await page.locator('.dl-backup-cal td.is-backup').count();
const next = await page.locator('.dl-backup-schedule__next li').allInnerTexts();
expect('calendário marca os dias e lista as próximas', marked >= 6 && next.length === 5 && next.every((t) => /^(seg|qua|sex)/.test(t)), `${marked} marcados; ${next.join(' | ')}`);
expect('dois meses no calendário', (await page.locator('.dl-backup-cal').count()) === 2);
await page.screenshot({ path: `${OUT}/backup-agendado.png`, fullPage: true });
await page.click('button:has-text("Salvar agendamento")');
await settle();
const put = calls.findLast((c) => c.method === 'PUT');
expect('salva dias, horário e o fuso do navegador', put?.body.enabled === true && put.body.mode === 'weekly' && JSON.stringify(put.body.days) === '[1,3,5]' && put.body.time === '02:00' && typeof put.body.timezone === 'string' && put.body.timezone.length > 0, JSON.stringify(put?.body));
expect('confirma e mostra o próximo', (await msgs()).includes('Agendamento salvo: seg, qua e sex às 02:00') && (await page.locator('.dl-backup-schedule__form').innerText()).includes('Próximo:'));
await page.selectOption('#schedule-mode', 'monthly');
await page.selectOption('#schedule-day-of-month', '5');
await settle(200);
const monthly = await page.locator('.dl-backup-schedule__next li').allInnerTexts();
expect('mensal: todo dia 5', monthly.length === 5 && monthly.every((t) => /\b05\//.test(t)), monthly.join(' | '));
// Backup gerado pelo agendamento aparece como "Agendado" na lista.
items.unshift({ ...items[0], id: 'b9', scheduled: true, createdBy: null });
await page.reload({ waitUntil: 'networkidle' });
await settle();
expect('backup do agendamento: "Agendado" em Por', (await rowText(0)).includes('Agendado'), await rowText(0));

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nbackup: tudo ok');
process.exit(failures ? 1 : 0);
