// Digest das imagens de terceiros do docker-compose.yml (hoje so o ClamAV).
//
// A tag (clamav/clamav:1.5) muda de conteudo sem aviso: dois `docker compose pull` em dias
// diferentes trazem imagens diferentes com o mesmo nome. Com o digest ao lado da tag, o compose
// sobe exatamente a imagem que foi testada, e a troca vira uma linha no diff. O preco: a correcao
// de seguranca da imagem so chega quando alguem roda este script (o Dependabot faz o mesmo, mas so
// com o repositorio num remoto).
//
//   node scripts/pin-images.mjs          confere: avisa se a tag ja aponta para outro digest
//   node scripts/pin-images.mjs --write  regrava o docker-compose.yml com o digest de agora
//
// Depois do --write: docker compose pull && docker compose up -d, e a bateria de testes.
// O Postgres saiu daqui: o compose o monta de apps/db/Dockerfile (base pinada + apk upgrade), e o
// digest do FROM e acompanhado pelo Dependabot (ecossistema docker). O MinIO (MINIO_IMAGE) fica
// de fora: e uma imagem escolhida por digest, sem tag para seguir.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'docker-compose.yml');
const IMAGES = ['clamav/clamav:1.5'];
const write = process.argv.includes('--write');

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const remoteDigest = (image) =>
  JSON.parse(
    execFileSync(
      'docker',
      ['buildx', 'imagetools', 'inspect', image, '--format', '{{json .Manifest.Digest}}'],
      { encoding: 'utf8' },
    ),
  );

let text = readFileSync(FILE, 'utf8');
let stale = 0;
for (const image of IMAGES) {
  const pinned = new RegExp(`${escape(image)}(@sha256:[0-9a-f]{64})?`);
  const found = pinned.exec(text);
  if (!found) {
    console.error(`FALHA ${image}: não está no docker-compose.yml`);
    process.exit(1);
  }
  const current = found[1]?.slice(1) ?? null;
  const latest = remoteDigest(image);
  if (current === latest) {
    console.log(`ok    ${image} ${latest.slice(0, 19)}`);
    continue;
  }
  stale++;
  console.log(`${write ? 'troca' : 'MUDOU'} ${image}: ${current ?? 'sem digest'} -> ${latest}`);
  text = text.replace(pinned, `${image}@${latest}`);
}
if (write && stale) writeFileSync(FILE, text);
if (!write && stale) {
  console.log('\nA tag já aponta para outra imagem: node scripts/pin-images.mjs --write');
  process.exit(1);
}
