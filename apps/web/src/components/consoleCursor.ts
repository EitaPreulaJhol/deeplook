/**
 * Cursor do console do sandbox (noVNC). O noVNC so mostra localmente o cursor que a VM manda
 * (pseudo-encoding de cursor do QEMU); quando ela nao manda nenhum, ou manda um transparente (o
 * Windows com o video VGA padrao desenha o cursor na propria imagem), ele poe `cursor: none` no
 * canvas e sobra so o cursor da imagem, que anda no ritmo dos quadros. Como no console do Proxmox,
 * aqui o cursor do sistema fica visivel nesse caso; o da VM, quando visivel, continua valendo.
 */

/** Cursor que o navegador mostra quando a VM nao manda um visivel. */
export const LOCAL_CURSOR = 'default';

/**
 * Troca o `cursor: none` do canvas pelo cursor do sistema, agora e a cada vez que o noVNC mudar o
 * estilo. Devolve a funcao que para de observar.
 */
export function keepLocalCursor(canvas: HTMLElement): () => void {
  const apply = () => {
    if (canvas.style.cursor === 'none' || canvas.style.cursor === '') {
      canvas.style.cursor = LOCAL_CURSOR;
    }
  };
  apply();
  const observer = new MutationObserver(apply);
  observer.observe(canvas, { attributes: true, attributeFilter: ['style'] });
  return () => observer.disconnect();
}
