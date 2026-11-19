import assert from 'node:assert/strict';
import { test } from 'node:test';

import { pdbHints, richTool } from '../../src/lib/pe-debug';

// Diretorio de debug e Rich header (plans/analise-estatica-ampliada, item 1).

test('pistas do caminho do PDB: usuário, projeto e configuração', () => {
  assert.deepEqual(
    pdbHints('C:\\Users\\Bob\\source\\repos\\Stealer\\Stealer\\obj\\Release\\Stealer.pdb'),
    { user: 'Bob', project: 'Stealer', debugBuild: false },
  );
  assert.deepEqual(pdbHints('D:\\Projetos\\Carregador\\x64\\Debug\\loader.pdb'), {
    user: null,
    project: 'Carregador',
    debugBuild: true,
  });
  // Rust no Linux com o alvo MSVC: target/release/deps.
  assert.deepEqual(pdbHints('/home/ana/dev/minerador/target/release/deps/minerador.pdb'), {
    user: 'ana',
    project: 'minerador',
    debugBuild: false,
  });
  // Pasta generica (agente de build) nao vira projeto; sem pasta de build, tambem nao.
  assert.equal(pdbHints('D:\\a\\_work\\1\\s\\out\\Release\\app.pdb').project, null);
  assert.equal(pdbHints('C:\\build\\app.pdb').project, null);
  assert.equal(pdbHints('app.pdb').project, null);
  assert.equal(pdbHints('C:\\Documents and Settings\\velho\\x\\Release\\a.pdb').user, 'velho');
});

test('Rich header: versão exata pelo comp.id e a família pelo produto', () => {
  assert.deepEqual(richTool(0x105, 30818), {
    tool: 'C++',
    version: 'VS2022 v17.1.0 pre 1.0 build 30818',
  });
  assert.deepEqual(richTool(0x102, 1), { tool: 'LNK', version: 'VS2015+ (14.0+) build 1' });
  assert.deepEqual(richTool(1, 0), { tool: 'IMP', version: null });
  assert.deepEqual(richTool(0, 0), { tool: null, version: null });
  assert.deepEqual(richTool(0xfff0, 5), { tool: null, version: null });
});
