import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { prisma } from '../../src/lib/prisma';
import {
  loadPackState,
  packRulesDir,
  resetYaraPackManifest,
  setYaraPackEnabled,
  yaraPacks,
} from '../../src/lib/yara-packs';
import { checkYaraPack, runDuePackChecks } from '../../src/lib/yara-update';

// YARA Forge instalado no servidor (plans/analise-estatica-ampliada, item 13): o manifesto local
// (rules/local-packs.json, fora do Git) se junta ao oficial, o pacote vem desligado, instala ao
// ligar e nunca se atualiza pelo GitHub. O teste grava um pacote local minimo e apaga no fim.

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};

async function main() {
  const dir = packRulesDir('yara-forge');
  const manifest = join(dir, '..', 'local-packs.json');
  mkdirSync(dir, { recursive: true });
  try {
    writeFileSync(
      join(dir, 'Teste.yar'),
      'import "pe"\nrule Forge_Teste { strings: $a = "forge-teste" condition: $a }\n',
    );
    writeFileSync(
      manifest,
      JSON.stringify([
        {
          id: 'yara-forge',
          name: 'YARA Forge (core)',
          author: 'YARA Forge (vários autores)',
          license: 'várias',
          url: 'https://github.com/YARAHQ/yara-forge',
          description: 'teste',
          defaultEnabled: false,
          repo: 'YARAHQ/yara-forge',
          folder: '',
          skipPrefixes: [],
          commit: '2026-11-08',
          commitDate: '2026-11-08',
          autoUpdate: false,
          files: ['Teste.yar'],
          excluded: [],
        },
        // Um id oficial repetido no manifesto local nao substitui o oficial.
        { id: 'reversinglabs', name: 'falso', files: [] },
      ]),
    );
    resetYaraPackManifest();
    const packs = yaraPacks();
    ok(
      'o manifesto local se junta ao oficial, sem substituir um pacote oficial',
      packs.some((p) => p.id === 'yara-forge') &&
        packs.find((p) => p.id === 'reversinglabs')?.name === 'ReversingLabs',
      packs.map((p) => p.id),
    );
    ok(
      'vem desligado e não instalado',
      !(await loadPackState()).installed.includes('yara-forge') &&
        (await prisma.yaraRule.count({ where: { pack: 'yara-forge' } })) === 0,
    );
    await setYaraPackEnabled('yara-forge', true);
    ok(
      'ligar instala as regras do servidor',
      (await prisma.yaraRule.count({ where: { pack: 'yara-forge' } })) === 1,
    );
    let refused = '';
    await checkYaraPack('yara-forge', { apply: true, actorId: null }).catch(
      (err: Error) => (refused = err.message),
    );
    const before = (await loadPackState()).lastCheck['yara-forge'];
    await runDuePackChecks({ warn: () => undefined });
    ok(
      'não se atualiza pelo GitHub: a verificação recusa, e a rotina diária o pula',
      refused.includes('vendor-yara-forge') &&
        (await loadPackState()).lastCheck['yara-forge'] === before,
      refused,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(manifest, { force: true });
  }
  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
  process.exit(fails ? 1 : 0);
}
main();
