import { buildApp } from '../../src/app';
import { hashPassword } from '../../src/lib/crypto';
import { prisma } from '../../src/lib/prisma';

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};

// Pontuacao de risco (item 7.5): a rota junta o que as analises gravaram na amostra.
async function main() {
  const app = await buildApp();
  await app.ready();

  const passwordHash = await hashPassword('senha-123!');
  const mk = (email: string, role: 'USER' | 'ANALYST') =>
    prisma.user.create({ data: { email, displayName: email, role, passwordHash } });
  const ana = await mk('ana@x.io', 'ANALYST');
  await mk('user@x.io', 'USER');
  const login = async (email: string) =>
    String(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { email, password: 'senha-123!' },
        })
      ).headers['set-cookie'],
    ).split(';')[0];
  const [cAna, cUser] = [await login('ana@x.io'), await login('user@x.io')];
  const risk = (id: string, c: string) =>
    app.inject({ method: 'GET', url: `/api/entries/${id}/risk`, headers: { cookie: c } });

  const quiet = await prisma.entry.create({
    data: { type: 'FILE', title: 'nada encontrado', ownerId: ana.id, staticInfo: {} },
  });
  const loud = await prisma.entry.create({
    data: {
      type: 'FILE',
      title: 'fatura.pdf.exe',
      ownerId: ana.id,
      staticInfo: {
        detectedType: { id: 'pe' },
        extensionMismatch: { declared: 'pdf', expected: ['exe'], dangerous: true },
        pe: {
          packer: 'UPX',
          alerts: [
            { level: 'high', text: 'seção gravável e executável' },
            { level: 'info', text: 'sem informação de versão' },
          ],
          signature: { signatureValid: false, digestMatches: false },
        },
      },
      antivirus: { create: { status: 'INFECTED', signature: 'Win.Trojan.Agent-1' } },
      yara: { create: { status: 'MATCHED', matches: [{ rule: 'Emotet' }, { rule: 'Packers' }] } },
      capaAnalysis: { create: { status: 'RUNNING' } },
      reputation: {
        create: [
          {
            service: 'virustotal',
            kind: 'HASH',
            indicator: 'ab',
            status: 'FOUND',
            verdict: 'MALICIOUS',
            summary: '40/70',
          },
          {
            service: 'malwarebazaar',
            kind: 'HASH',
            indicator: 'ab',
            status: 'PENDING',
            summary: '',
          },
        ],
      },
    },
  });

  ok(
    'sem sessão: 401',
    (await app.inject({ method: 'GET', url: `/api/entries/${loud.id}/risk` })).statusCode === 401,
  );
  ok('usuário comum: 403', (await risk(loud.id, cUser)).statusCode === 403);
  ok('amostra que não existe: 404', (await risk('nao-existe', cAna)).statusCode === 404);

  const empty = (await risk(quiet.id, cAna)).json();
  ok(
    'sem sinais: nota 0 e nenhuma sugestão',
    empty.risk.score === 0 &&
      empty.risk.suggestedVerdict === null &&
      empty.risk.reasons.length === 0,
    empty,
  );
  ok(
    'a resposta traz os limiares',
    empty.thresholds.malicious === 70 && empty.thresholds.suspicious === 35,
  );

  const full = (await risk(loud.id, cAna)).json().risk;
  const sources = full.reasons.map((r: { source: string }) => r.source);
  ok(
    'junta todas as análises gravadas',
    full.score === 100 && full.suggestedVerdict === 'MALICIOUS',
    full,
  );
  ok(
    'cada análise aparece como motivo',
    [
      'Antivírus',
      'YARA',
      'Reputação externa',
      'Tipo do arquivo',
      'Executável',
      'Assinatura',
      'Empacotamento',
    ].every((s) => sources.includes(s)),
    sources,
  );
  ok(
    'os motivos trazem o que foi encontrado',
    full.reasons.some((r: { text: string }) => r.text.includes('Win.Trojan.Agent-1')) &&
      full.reasons.some((r: { text: string }) => r.text.includes('Emotet')) &&
      full.reasons.some((r: { text: string }) => r.text.includes('VirusTotal')),
    full.reasons,
  );
  ok(
    'análises em andamento são avisadas',
    full.pending.includes('análise de funções') && full.pending.includes('reputação externa'),
    full.pending,
  );

  // Na lixeira, a amostra some tambem daqui.
  await prisma.entry.update({ where: { id: loud.id }, data: { deletedAt: new Date() } });
  ok('amostra na lixeira: 404', (await risk(loud.id, cAna)).statusCode === 404);

  await app.close();
  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\nTudo certo');
  process.exit(fails ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
