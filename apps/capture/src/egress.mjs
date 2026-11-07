// Proxy de saida da captura (item 6.19). A rede `capture` e interna: sem saida, sem DNS externo
// e sem IP do host. O Chromium so alcanca a internet por este container, que fica nela e numa
// rede com saida, e aplica a mesma regra do proxy de dentro da captura: o nome e resolvido uma
// vez, rede interna, loopback e metadados sao recusados, e a conexao vai para o IP conferido.
// Ao contrario do de dentro, este vale mesmo que o navegador deixe de obedecer: e o unico caminho.
// Nao roda codigo de pagina nenhuma; e um processo de vida longa que atende todas as capturas.
import { startProxy } from './proxy.mjs';

const PORT = Number(process.env.PORT || 3128);
/** So para testes: nomes liberados mesmo em rede interna (vazio em producao). */
const ALLOW_HOSTS = new Set(
  (process.env.CAPTURE_ALLOW_HOSTS || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean),
);

const proxy = await startProxy({ allowHosts: ALLOW_HOSTS, host: '0.0.0.0', port: PORT });
console.log(`[egress] proxy de saída da captura ouvindo na porta ${proxy.port}`);
if (ALLOW_HOSTS.size) {
  console.warn(`[egress] CAPTURE_ALLOW_HOSTS liberando ${[...ALLOW_HOSTS].join(', ')} (só testes)`);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await proxy.close();
    process.exit(0);
  });
}
