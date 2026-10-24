// E-mail suspeito (54): secao E-mail da ficha (cabecalhos, autenticacao com
// cores, Responder para de outro dominio, caminho na ordem, links so como
// texto, corpo em texto sem HTML), anexos (link para a filha e o ignorado),
// "Anexo de" no topo da filha e IOCs sugeridos com links e dominios.
import { chromium } from 'playwright';

import { createState, entries, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const state = createState({ loggedIn: true });
await setupMock(context, state);
const page = await context.newPage();
watchErrors(page);

let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};
const settle = (ms = 500) => page.waitForTimeout(ms);

entries[0].emailInfo = {
  version: 1,
  subject: 'Boleto vencido',
  from: { name: 'Banco', address: 'cobranca@banco.test' },
  sender: null,
  replyTo: [{ name: null, address: 'golpe@evil.test' }],
  to: [{ name: 'Maria', address: 'maria@vitima.test' }],
  cc: [],
  date: '2026-10-22T10:00:00.000Z',
  messageId: '<abc@evil.test>',
  returnPath: null,
  auth: { spf: 'fail', dkim: null, dmarc: 'pass' },
  received: [
    { from: 'evil.test (unknown [185.199.1.7])', by: 'relay.vitima.test', date: '2026-10-22T10:00:00.000Z' },
    { from: 'relay.vitima.test', by: 'mail.vitima.test', date: '2026-10-22T10:00:05.000Z' },
  ],
  links: ['https://boleto-falso.test/pagar'],
  body: 'Pague o boleto hoje.\n<script>window.hacked = true</script>',
  bodyTruncated: false,
  attachments: [
    { filename: 'relatorio_trimestral.docm', mimeType: 'application/vnd.ms-word', size: 88211, entryId: 'e3' },
    { filename: 'gigante.iso', mimeType: 'application/octet-stream', size: 999999999, skipped: 'maior que o limite de upload' },
  ],
};
entries[2].parentEntry = { id: 'e1', title: entries[0].title };

// 1. Secao E-mail.
await page.goto(ORIGIN + '/entries/e1', { waitUntil: 'networkidle' });
const section = page.locator('section.hpsm-section:has(.hpsm-section__head:has-text("E-mail"))').first();
const field = (label) => section.locator(`.hpsm-field:has(.hpsm-field__label:text-is("${label}:"))`);
expect('assunto', (await field('Assunto').innerText()).includes('Boleto vencido'));
expect('remetente', (await field('De').innerText()).includes('Banco <cobranca@banco.test>'));
expect('Responder para de outro domínio', (await field('Responder para').innerText()).includes('domínio diferente do remetente'));
expect('destinatários visíveis', (await field('Para').innerText()).includes('Maria <maria@vitima.test>'));
const auth = (await field('Autenticação').innerText()).replace(/\s+/g, ' ');
expect('autenticação', auth.includes('SPF: fail') && auth.includes('DKIM: ausente') && auth.includes('DMARC: pass'), auth);
expect('cores da autenticação', (await field('Autenticação').locator('.hpsm-status--red').count()) === 1 && (await field('Autenticação').locator('.hpsm-status--green').count()) === 1);
const hops = (await section.locator('.dl-email-hops li').allInnerTexts()).map((t) => t.replace(/\s+/g, ' '));
expect('caminho do primeiro ao último', hops.length === 2 && hops[0].startsWith('evil.test') && hops[1].startsWith('relay.vitima.test'), JSON.stringify(hops));
expect('links só como texto', (await field('Links (1)').innerText()).includes('https://boleto-falso.test/pagar') && (await field('Links (1)').locator('a').count()) === 0);
expect('corpo em texto, HTML não interpretado', (await field('Corpo').innerText()).includes('<script>') && !(await page.evaluate(() => window.hacked)));
const attachments = page.locator('.dl-email-attachments li');
expect('anexo vira link para a amostra', (await attachments.first().locator('a').getAttribute('href')) === '/entries/e3');
expect('anexo ignorado com o motivo', (await attachments.nth(1).innerText()).includes('não enviado: maior que o limite de upload') && (await attachments.nth(1).locator('a').count()) === 0);
await page.screenshot({ path: `${OUT}/email.png`, fullPage: true });

// 2. IOCs sugeridos no relatorio.
await page.goto(ORIGIN + '/entries/e1?tab=relatorios', { waitUntil: 'networkidle' });
const suggest = page.locator('button:has-text("Inserir IOCs sugeridos")');
await suggest.click();
await settle(200);
const iocs = await page.inputValue('#report-iocs');
expect('sugere links e domínios do e-mail', iocs.includes('https://boleto-falso.test/pagar') && iocs.includes('banco.test') && iocs.includes('evil.test'), iocs);

// 3. Anexo: "Anexo de" no topo.
await page.goto(ORIGIN + '/entries/e3', { waitUntil: 'networkidle' });
const parent = page.locator('.dl-summary span:has(.dl-summary__label:text-is("Anexo de:"))');
expect('filha mostra o e-mail de origem', (await parent.locator('a').getAttribute('href')) === '/entries/e1');
expect('sem seção E-mail na filha', (await page.locator('.hpsm-section__head:has-text("E-mail")').count()) === 0);

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\ne-mail: tudo ok');
process.exit(failures ? 1 : 0);
