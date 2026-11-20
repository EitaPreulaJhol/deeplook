import assert from 'node:assert/strict';
import { test } from 'node:test';

import { matchDocumentIcon, withDocumentIconAlert } from '../../src/lib/document-icons';

// Icone de documento num executavel (plans/analise-estatica-ampliada, item 2).

const icons = [{ hash: 'f0e0c0c0c0c0e0f0', label: 'Word' }];

test('ícone a até 4 bits casa; mais longe, não', () => {
  assert.equal(matchDocumentIcon('f0e0c0c0c0c0e0f1', icons)?.label, 'Word');
  assert.equal(matchDocumentIcon('0f1f3f3f3f3f1f0f', icons), null);
  assert.equal(matchDocumentIcon(null, icons), null);
});

test('o alerta entra, não duplica e sai quando a lista muda', () => {
  const info = {
    pe: { icon: { hash: 'f0e0c0c0c0c0e0f0' }, alerts: [{ level: 'medium', text: 'outro' }] },
  };
  const marked = withDocumentIconAlert(info, icons)!;
  assert.deepEqual(
    marked.pe!.alerts!.map((a) => a.text),
    [
      'Ícone de documento (Word) num executável: isca para abrir achando que é um documento.',
      'outro',
    ],
  );
  assert.equal(withDocumentIconAlert(marked, icons), null);
  assert.deepEqual(withDocumentIconAlert(marked, [])!.pe!.alerts, [
    { level: 'medium', text: 'outro' },
  ]);
});
