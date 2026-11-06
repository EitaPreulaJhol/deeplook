// Le um servico do docker-compose.yml como o Docker Compose o resolve e devolve o que o
// `docker run` precisa para rodar a imagem com a MESMA configuracao: somente leitura, sem
// capacidades, limites e healthcheck. Os testes de imagem usam isto para exercitar o que vai
// para producao, sem copiar valores que poderiam divergir do compose (item 6.5).
import { spawnSync } from 'node:child_process';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export function composeService(name) {
  const res = spawnSync('docker', ['compose', 'config', '--format', 'json'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (res.status !== 0) throw new Error(`docker compose config falhou: ${res.stderr}`);
  const service = JSON.parse(res.stdout).services?.[name];
  if (!service) throw new Error(`o servico ${name} nao existe no compose`);
  return service;
}

/** Argumentos do `docker run` equivalentes ao endurecimento e ao healthcheck do servico. */
export function runArgs(service, { healthInterval = '2s' } = {}) {
  const args = [];
  if (service.read_only) args.push('--read-only');
  for (const tmpfs of service.tmpfs ?? []) args.push('--tmpfs', tmpfs);
  for (const cap of service.cap_drop ?? []) args.push('--cap-drop', cap);
  // O perfil seccomp do compose e relativo a raiz do projeto (o Compose resolve assim); o
  // `docker run` o leria relativo ao diretorio de quem chama.
  for (const opt of service.security_opt ?? []) {
    const profile = /^seccomp=(.+)$/.exec(opt)?.[1];
    const resolved =
      profile && profile !== 'unconfined' && !isAbsolute(profile)
        ? `seccomp=${join(ROOT, profile)}`
        : opt;
    args.push('--security-opt', resolved);
  }
  if (service.shm_size) args.push('--shm-size', String(service.shm_size));
  if (service.mem_limit) args.push('--memory', String(service.mem_limit));
  if (service.pids_limit) args.push('--pids-limit', String(service.pids_limit));
  const test = service.healthcheck?.test;
  if (test) {
    // ["CMD", "a", "b"] vira "a b"; ["CMD-SHELL", "cmd"] ja e o comando.
    const cmd = test[0] === 'CMD-SHELL' ? test[1] : test.slice(1).join(' ');
    args.push(
      '--health-cmd',
      cmd,
      '--health-interval',
      healthInterval,
      '--health-timeout',
      '5s',
      '--health-retries',
      '5',
    );
  }
  return args;
}
