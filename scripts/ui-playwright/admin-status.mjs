// Status do sistema (42): aba da Administracao pelo navegador, situacao de cada
// componente (cores e rotulos), aviso geral de falha/alerta, detalhes, linha com
// falha destacada e botao Atualizar.
import { chromium } from 'playwright';

import { createState, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const state = createState({ loggedIn: true });
state.systemStatus = {
  checkedAt: '2026-10-22T15:30:00.000Z',
  overall: 'error',
  checks: [
    { id: 'api', name: 'API', level: 'ok', summary: 'versão 1.0.0 · no ar há 3 h 12 min', details: [{ label: 'Node.js', value: 'v22.11.0' }] },
    { id: 'database', name: 'Banco de dados', level: 'ok', summary: 'respondendo', latencyMs: 4, details: [{ label: 'Usuários ativos', value: '3' }, { label: 'Amostras', value: '4' }] },
    { id: 'storage', name: 'Armazenamento (MinIO)', level: 'error', summary: 'conexão recusada', latencyMs: 217, details: [{ label: 'Bucket', value: 'deeplook-samples' }] },
    { id: 'sandbox', name: 'Ambiente isolado (Proxmox)', level: 'off', summary: 'desligado (SANDBOX_ENABLED=false)', details: [] },
    { id: 'queues', name: 'Filas', level: 'warn', summary: '1 amostra atrasada', details: [{ label: 'Pendentes', value: '1' }] },
  ],
};
await setupMock(context, state);
const page = await context.newPage();
watchErrors(page);

let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};
const settle = (ms = 400) => page.waitForTimeout(ms);
const row = (name) => page.locator(`tbody tr:has-text("${name}")`);

await page.goto(ORIGIN + '/inicio', { waitUntil: 'networkidle' });
await page.click('.hpsm-tree a:has-text("Status do sistema")');
await settle();
expect('navegador abre a aba', new URL(page.url()).search === '?tab=status');
expect('cinco componentes', (await page.locator('tbody tr').count()) === 5);
expect('aviso geral de falha', (await page.locator('.hpsm-msg__text').allTextContents()).includes('Há componentes com falha. Veja os detalhes abaixo.'));

const levels = await page.locator('tbody tr td:nth-child(2)').allTextContents();
expect('rótulos da situação', levels.map((t) => t.trim()).join('|') === 'OK|OK|Falha|Desligado|Alerta', levels.join('|'));
const tone = (name) => row(name).locator('.hpsm-status').getAttribute('class');
expect('cores: verde, vermelho, cinza, laranja', (await tone('API')).includes('green') && (await tone('MinIO')).includes('red') && (await tone('Proxmox')).includes('gray') && (await tone('Filas')).includes('orange'));
expect('resumo e tempo', (await row('MinIO').locator('td').nth(2).textContent()) === 'conexão recusada' && (await row('MinIO').locator('td').nth(3).textContent()) === '217 ms');
expect('sem tempo = "—"', (await row('Filas').locator('td').nth(3).textContent()) === '—');
const details = (await row('Banco de dados').locator('td').nth(4).innerText()).replace(/\s+/g, ' ').trim();
expect('detalhes em linha', details === 'Usuários ativos: 3 · Amostras: 4', details);
const bg = await row('MinIO').locator('td').first().evaluate((el) => getComputedStyle(el).backgroundColor);
expect('linha com falha destacada', bg === 'rgb(253, 236, 234)', bg);
expect('hora da verificação', (await page.locator('.hpsm-toolbar__info').textContent())?.includes('atualiza a cada 30 s'));
await page.screenshot({ path: `${OUT}/status-sistema.png` });

// Atualizar pede de novo; sem falha, o aviso some (alerta vira aviso amarelo).
const before = state.statusCalls;
state.systemStatus = { ...state.systemStatus, overall: 'warn', checks: state.systemStatus.checks.map((c) => (c.id === 'storage' ? { ...c, level: 'ok', summary: 'bucket acessível', latencyMs: 5 } : c)) };
await page.click('.hpsm-toolbar__action:has-text("Atualizar")');
await settle(600);
expect('Atualizar consulta de novo', state.statusCalls > before);
const msgs = await page.locator('.hpsm-msg__text').allTextContents();
expect('agora só alerta', msgs.includes('Há componentes em alerta. Veja os detalhes abaixo.') && !msgs.some((t) => t.includes('falha')), msgs.join(' | '));

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nstatus do sistema: tudo ok');
process.exit(failures ? 1 : 0);
