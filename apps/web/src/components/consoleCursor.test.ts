// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { keepLocalCursor, LOCAL_CURSOR } from './consoleCursor';

/** O MutationObserver avisa numa microtarefa. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('keepLocalCursor', () => {
  it('sem cursor da VM (cursor: none), mostra o do sistema na hora e depois', async () => {
    const canvas = document.createElement('canvas');
    canvas.style.cursor = 'none';
    const stop = keepLocalCursor(canvas);
    expect(canvas.style.cursor).toBe(LOCAL_CURSOR);
    canvas.style.cursor = 'none';
    await flush();
    expect(canvas.style.cursor).toBe(LOCAL_CURSOR);
    stop();
  });

  it('cursor visível da VM (imagem) fica como está', async () => {
    const canvas = document.createElement('canvas');
    const stop = keepLocalCursor(canvas);
    canvas.style.cursor = 'url("data:image/png;base64,AAAA") 1 1, default';
    await flush();
    expect(canvas.style.cursor).toContain('url(');
    stop();
  });

  it('depois de parar, não mexe mais', async () => {
    const canvas = document.createElement('canvas');
    const stop = keepLocalCursor(canvas);
    stop();
    canvas.style.cursor = 'none';
    await flush();
    expect(canvas.style.cursor).toBe('none');
  });
});
