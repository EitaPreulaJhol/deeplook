import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  exifDate,
  metadataAlerts,
  metadataPivots,
  type MetadataResult,
} from '../../src/lib/metadata';

// Metadados com o ExifTool (plans/analise-estatica-ampliada, item 19).

const result = (fields: Partial<MetadataResult['fields']>): MetadataResult => ({
  groups: {},
  keys: 0,
  fields: { authors: [], tools: [], xmpIds: [], created: [], modified: [], ...fields },
});

test('datas do ExifTool, com e sem fuso', () => {
  assert.equal(exifDate('2026:05:10 10:00:00Z')?.toISOString(), '2026-05-10T10:00:00.000Z');
  assert.equal(exifDate('2026:05:10 10:00:00-03:00')?.toISOString(), '2026-05-10T13:00:00.000Z');
  assert.equal(exifDate('0000:00:00 00:00:00'), null);
  assert.equal(exifDate('ontem'), null);
});

test('modificado antes de criado e data no futuro viram aviso; um dia de folga não', () => {
  const now = new Date('2026-11-19T00:00:00Z');
  assert.deepEqual(
    metadataAlerts(
      result({ created: ['2026:05:10 10:00:00Z'], modified: ['2026:01:01 08:00:00Z'] }),
      now,
    ).map((a) => a.text),
    [
      'Modificado (2026-01-01) antes de criado (2026-05-10): datas editadas ou copiadas de um modelo',
    ],
  );
  assert.deepEqual(
    metadataAlerts(
      result({ created: ['2026:05:10 10:00:00Z'], modified: ['2026:05:10 02:00:00Z'] }),
      now,
    ),
    [],
  );
  assert.equal(
    metadataAlerts(result({ created: ['2030:01:01 00:00:00Z'] }), now)[0]?.text,
    'Data no futuro nos metadados: 2030-01-01',
  );
});

test('pivôs: autores, ferramentas e IDs do XMP, sem os nomes genéricos', () => {
  assert.deepEqual(
    metadataPivots(
      result({
        authors: ['Joao Golpista', 'Administrator', 'Usuário'],
        tools: ['FabricaDeFaturas 3.1'],
        xmpIds: ['6F1C2A9E-0B7D-4C55-9F3E-2D8A7B1C0E44'],
      }),
    ),
    [
      { kind: 'DOC_AUTHOR', value: 'Joao Golpista' },
      { kind: 'DOC_TOOL', value: 'FabricaDeFaturas 3.1' },
      { kind: 'XMP_ID', value: '6f1c2a9e-0b7d-4c55-9f3e-2d8a7b1c0e44' },
    ],
  );
});
