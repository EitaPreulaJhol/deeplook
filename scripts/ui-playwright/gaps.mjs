// Espaco vertical entre cada secao (.hpsm-section) e o bloco anterior, em varias telas.
// Ferramenta da varredura visual: node gaps.mjs (GAPS_SIZE=1366x768).
import { chromium } from 'playwright';
import { createState, entries, ORIGIN, runningSandbox, setupMock } from './mock-api.mjs';
const [w, h] = (process.env.GAPS_SIZE || '1366x768').split('x').map(Number);
const routes = process.argv.slice(2).length ? process.argv.slice(2) : [
  '/painel', '/busca?q=boleto', '/casos/cs1', '/comparar?a=e1&b=e4', '/yara', '/kb', '/user/api',
  '/entries/e1?tab=detalhes', '/entries/e1?tab=analise', '/entries/e1?tab=relatorios', '/entries/e2?tab=detalhes',
  '/entries/e3?tab=detalhes', '/admin?tab=settings', '/admin?tab=templates', '/permitidos', '/user?tab=dados',
];
const browser = await chromium.launch();
for (const route of routes) {
  const context = await browser.newContext({ viewport: { width: w, height: h } });
  const state = createState({ loggedIn: true });
  state.sandboxes.e1 = runningSandbox('e1', 40);
  const e1 = entries.find((e) => e.id === 'e1');
  state.cases = [{ id: 'cs1', number: 1, code: 'CASO-0001', title: 'Caso', description: null, status: 'OPEN', createdAt: e1.createdAt, updatedAt: e1.createdAt, closedAt: null, assignee: null, createdBy: { id: 'u1', displayName: 'Ana' }, entries: [], events: [] }];
  await setupMock(context, state);
  const page = await context.newPage();
  await page.goto(ORIGIN + route, { waitUntil: 'networkidle' });
  const gaps = await page.evaluate(() =>
    [...document.querySelectorAll('.hpsm-section')]
      .filter((s) => s.getBoundingClientRect().height > 0)
      .map((s) => {
        let prev = s.previousElementSibling;
        while (prev && prev.getBoundingClientRect().height === 0) prev = prev.previousElementSibling;
        if (!prev) return null;
        const gap = Math.round(s.getBoundingClientRect().top - prev.getBoundingClientRect().bottom);
        const name = (s.querySelector('.hpsm-section__title, .hpsm-section__head')?.innerText || '').trim().slice(0, 30);
        const prevName = `${prev.tagName.toLowerCase()}.${String(prev.className).split(' ')[0]}`;
        return `${gap}px  ${prevName} -> "${name}"`;
      })
      .filter(Boolean),
  );
  console.log(`== ${route}\n${gaps.join('\n')}`);
  await context.close();
}
await browser.close();
