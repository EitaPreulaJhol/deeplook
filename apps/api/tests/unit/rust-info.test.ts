import assert from 'node:assert/strict';
import { test } from 'node:test';

import { rustInfo } from '../../src/lib/rust-info';

// Rust pelas mensagens de panic (plans/analise-estatica-ampliada, item 14).

test('crates com versão, commit do rustc e os fontes do projeto', () => {
  const info = rustInfo([
    'C:\\Users\\dev\\.cargo\\registry\\src\\index.crates.io-6f17d22bba15001f\\tokio-1.32.0\\src\\runtime\\mod.rs',
    '/home/dev/.cargo/registry/src/index.crates.io-6f17d22bba15001f/reqwest-0.11.20/src/lib.rs',
    '/rustc/90c541806f23a127002de5b4038be731ba1458ca/library/core/src/panicking.rs',
    'C:\\Users\\dev\\projetos\\ladrao\\src\\main.rs',
  ])!;
  assert.deepEqual(info.crates, [
    { name: 'reqwest', version: '0.11.20' },
    { name: 'tokio', version: '1.32.0' },
  ]);
  assert.equal(info.rustc, '90c541806f23a127002de5b4038be731ba1458ca');
  assert.deepEqual(info.sources, ['C:\\Users\\dev\\projetos\\ladrao\\src\\main.rs']);
});

test('sem marcas do Rust, nada', () => {
  assert.equal(rustInfo(['C:\\Windows\\System32\\kernel32.dll', 'main.rs']), null);
});
