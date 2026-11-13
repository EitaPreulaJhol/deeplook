import { buildApp } from '../../src/app';
import { ensureBucket } from '../../src/lib/s3';

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};

interface Ready {
  status: string;
  checks: { name: string; ok: boolean }[];
}

async function main() {
  await ensureBucket();
  const app = await buildApp();
  await app.ready();

  // 1. Liveness: responde sem tocar em dependencia nenhuma.
  const live = await app.inject({ method: 'GET', url: '/api/health' });
  ok('liveness responde 200', live.statusCode === 200, live.statusCode);
  ok('liveness diz ok', live.json<{ status: string }>().status === 'ok', live.body);

  // 2. Readiness com banco e MinIO no ar.
  const ready = await app.inject({ method: 'GET', url: '/api/health/ready' });
  const body = ready.json<Ready>();
  ok('readiness responde 200', ready.statusCode === 200, ready.statusCode);
  ok('readiness diz ok', body.status === 'ok', body);
  ok(
    'readiness lista banco e armazenamento',
    body.checks.length === 2 &&
      body.checks.every((c) => c.ok) &&
      body.checks.some((c) => c.name === 'database') &&
      body.checks.some((c) => c.name === 'storage'),
    body.checks,
  );
  // A rota e publica: nada de endereco, bucket ou credencial na resposta.
  ok(
    'readiness nao vazia endereco nem credencial',
    !/localhost|127\.0\.0\.1|:\d{4,5}|deeplook123|password/i.test(JSON.stringify(body)),
    body,
  );

  // 3. Dependencia fora: 503 e o motivo some da resposta.
  //    Derruba so o S3 apontando o cliente para uma porta fechada.
  const { s3 } = await import('../../src/lib/s3');
  const original = s3.config.endpoint;
  // Troca o endpoint em tempo de execucao so para este teste.
  s3.config.endpoint = async () => ({
    protocol: 'http:',
    hostname: '127.0.0.1',
    port: 1,
    path: '/',
  });
  // O cache de 1 s guarda o resultado anterior: espera vencer.
  await new Promise((r) => setTimeout(r, 1100));
  const down = await app.inject({ method: 'GET', url: '/api/health/ready' });
  const downBody = down.json<Ready>();
  ok('MinIO fora = 503', down.statusCode === 503, down.statusCode);
  ok('MinIO fora = degraded', downBody.status === 'degraded', downBody);
  ok(
    'MinIO fora: banco ok, armazenamento nao',
    downBody.checks.find((c) => c.name === 'database')?.ok === true &&
      downBody.checks.find((c) => c.name === 'storage')?.ok === false,
    downBody.checks,
  );
  ok(
    'motivo da falha fica fora da resposta',
    !/reason|ECONNREFUSED|recusada/i.test(JSON.stringify(downBody)),
    downBody,
  );
  s3.config.endpoint = original;

  // 4. O cache responde sem repetir a consulta (duas chamadas seguidas).
  await new Promise((r) => setTimeout(r, 1100));
  const first = await app.inject({ method: 'GET', url: '/api/health/ready' });
  const second = await app.inject({ method: 'GET', url: '/api/health/ready' });
  ok(
    'duas sondas seguidas respondem igual',
    first.statusCode === 200 && second.statusCode === 200,
    [first.statusCode, second.statusCode],
  );

  await app.close();
  process.exit(fails ? 1 : 0);
}

main().catch((err) => {
  console.log('FALHA', err);
  process.exit(1);
});
