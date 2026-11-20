/* Dump de memoria ao fim da emulacao (plans/analise-estatica-ampliada, item 16): decifra um PE
 * (XOR 0x5a, gerado pelo gen.sh a partir do payload.bin) numa regiao do VirtualAlloc, como faz um
 * carregador. O PE so existe inteiro na memoria emulada. */
#include <windows.h>

#include "carga.h"

int main(void) {
  unsigned char *mem = VirtualAlloc(NULL, sizeof carga, MEM_COMMIT | MEM_RESERVE,
                                    PAGE_EXECUTE_READWRITE);
  if (!mem) return 1;
  for (unsigned i = 0; i < sizeof carga; i++) mem[i] = carga[i] ^ 0x5a;
  return mem[0] == 'M' ? 0 : 2;
}
