// Diff entre execucoes do sandbox (plans/novas-analises, item 8): a normalizacao, sem banco.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { normalizeCommand, normalizePath, normalizeRegistry } from '../../src/lib/sandbox-compare';

test('caminho: perfil, temporários, GUIDs e nomes aleatórios', () => {
  assert.equal(
    normalizePath('C:\\Users\\analista\\AppData\\Local\\Temp\\tmp1A2B.tmp'),
    '%temp%\\tmp<x>.tmp',
  );
  assert.equal(
    normalizePath('C:\\Users\\outro\\AppData\\Local\\Temp\\tmp9F.tmp'),
    '%temp%\\tmp<x>.tmp',
  );
  assert.equal(
    normalizePath('C:\\Users\\a\\AppData\\Roaming\\{1B2C3D4E-0000-1111-2222-333344445555}\\x.dll'),
    '%appdata%\\<guid>\\x.dll',
  );
  assert.equal(
    normalizePath('C:\\Users\\a\\Desktop\\nota.txt'),
    '%userprofile%\\desktop\\nota.txt',
  );
  assert.equal(normalizePath('C:\\Windows\\Temp\\3f2a.tmp'), '%windir%\\temp\\<x>.tmp');
  // O que importa fica: o nome do arquivo largado.
  assert.notEqual(normalizePath('C:\\ProgramData\\a.exe'), normalizePath('C:\\ProgramData\\b.exe'));
});

test('linha de comando: PIDs, espaços e o perfil não fazem diferença', () => {
  assert.equal(
    normalizeCommand('rundll32.exe  C:\\Users\\ana\\AppData\\Local\\Temp\\x.dll,Start 4410'),
    normalizeCommand('rundll32.exe C:\\Users\\bia\\AppData\\Local\\Temp\\x.dll,Start 5120'),
  );
  assert.notEqual(normalizeCommand('cmd /c whoami'), normalizeCommand('cmd /c ipconfig'));
});

test('registro: o SID do usuário e HKCU são a mesma coisa', () => {
  const run = 'Software\\Microsoft\\Windows\\CurrentVersion\\Run\\Updater';
  assert.equal(
    normalizeRegistry(`HKU\\S-1-5-21-111-222-333-1001\\${run}`),
    `hkcu\\${run.toLowerCase()}`,
  );
  assert.equal(
    normalizeRegistry(`HKU\\S-1-5-21-444-555-666-1002\\${run}`),
    normalizeRegistry(`HKEY_CURRENT_USER\\${run}`),
  );
  assert.equal(
    normalizeRegistry('HKU\\S-1-5-21-1-2-3-1001_Classes\\CLSID\\x'),
    'hkcu\\software\\classes\\clsid\\x',
  );
});
