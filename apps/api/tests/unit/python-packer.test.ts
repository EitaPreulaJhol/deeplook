import assert from 'node:assert/strict';
import { test } from 'node:test';

import { pythonPacker } from '../../src/lib/pe-analysis';

// Executavel feito de Python por ferramenta que o desempacotador nao abre (item 15).

test('Nuitka, py2exe e cx_Freeze pelas marcas que deixam no executável', () => {
  const pe = (s: string) => Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64), Buffer.from(s)]);
  assert.equal(pythonPacker(pe('NUITKA_ONEFILE_PARENT')), 'nuitka');
  assert.equal(pythonPacker(pe('PYTHONSCRIPT\0PY2EXE_VERBOSE')), 'py2exe');
  assert.equal(pythonPacker(pe('cx_Freeze: Python error in main script')), 'cxfreeze');
  assert.equal(pythonPacker(pe('PYTHONSCRIPT')), null);
  assert.equal(pythonPacker(pe('kernel32.dll')), null);
});
