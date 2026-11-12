import { RestoreError, type RestoreMode, runRestore } from './lib/restore';

/**
 * Restauracao de um backup pela linha de comando (revisao de novembro, item 1.2). Roda na imagem
 * da API, que ja tem o pg_restore, a configuracao do banco e a do MinIO; quem chama e o
 * scripts/restore.sh, com o ZIP montado em /restore/backup.zip.
 *
 *   node dist/restore.js <zip> --check       so confere o ZIP com o manifesto
 *   node dist/restore.js <zip> --rehearsal   ensaio: banco e bucket temporarios, depois apagados
 *   node dist/restore.js <zip>               restaura na instalacao (--force para sobrescrever)
 *
 * A senha do ZIP vem em RESTORE_PASSWORD (nunca como argumento: apareceria na lista de processos).
 */
async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith('--')));
  const [file] = args.filter((a) => !a.startsWith('--'));
  const known = ['--check', '--rehearsal', '--force'];
  const unknown = [...flags].filter((f) => !known.includes(f));
  if (!file || unknown.length || (flags.has('--check') && flags.has('--rehearsal'))) {
    console.error('uso: restore <backup.zip> [--check | --rehearsal] [--force]');
    if (unknown.length) console.error(`opção desconhecida: ${unknown.join(', ')}`);
    return 2;
  }
  const mode: RestoreMode = flags.has('--check')
    ? 'check'
    : flags.has('--rehearsal')
      ? 'rehearsal'
      : 'restore';
  const result = await runRestore({
    file,
    password: process.env.RESTORE_PASSWORD || null,
    mode,
    force: flags.has('--force'),
    log: (message) => console.log(`[restauração] ${message}`),
  });
  if (result.counts) {
    for (const [name, c] of Object.entries(result.counts)) {
      console.log(`[restauração] ${name}: ${c.restored} (backup: ${c.backup})`);
    }
  }
  console.log(
    mode === 'check'
      ? `[restauração] ZIP íntegro: ${result.verified} arquivo(s) conferidos. Nada foi alterado.`
      : mode === 'rehearsal'
        ? `[restauração] ensaio concluído: o backup volta (${result.objects} objeto(s)). ` +
          'O banco e o bucket do ensaio foram apagados; a instalação não foi tocada.'
        : `[restauração] concluída em ${result.database} e ${result.bucket} (${result.objects} objeto(s)). ` +
          'Confira o DATA_KEY (ou o SESSION_SECRET) da instalação de origem no .env e suba o DeepLook.',
  );
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    if (err instanceof RestoreError) console.error(`[restauração] FALHA: ${err.message}`);
    else console.error('[restauração] FALHA inesperada:', err);
    process.exit(1);
  },
);
