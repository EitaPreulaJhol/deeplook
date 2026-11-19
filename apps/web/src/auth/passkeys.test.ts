import { describe, expect, it } from 'vitest';

import { passkeyCancelled } from './passkeys';

describe('passkeyCancelled', () => {
  it('cancelar ou esgotar o tempo no aparelho não é erro do sistema', () => {
    expect(passkeyCancelled(new DOMException('cancelled', 'NotAllowedError'))).toBe(true);
    expect(passkeyCancelled(new DOMException('aborted', 'AbortError'))).toBe(true);
  });

  it('outros erros continuam sendo mostrados', () => {
    expect(passkeyCancelled(new Error('Credenciais inválidas.'))).toBe(false);
    expect(passkeyCancelled(new DOMException('x', 'InvalidStateError'))).toBe(false);
    expect(passkeyCancelled('texto')).toBe(false);
  });
});
