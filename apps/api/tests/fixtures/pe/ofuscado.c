/* Strings que nao existem no arquivo (item 7.2): montadas na pilha e decifradas por XOR. O FLOSS
 * as recupera emulando o codigo; a extracao de strings comum nao as ve. Nunca e executado. */
#include <windows.h>

/* "http://xor.evil.test/painel" com XOR 0x5A, byte a byte. */
static const unsigned char CIFRADO[] = {0x32, 0x2e, 0x2e, 0x2a, 0x60, 0x75, 0x75, 0x22, 0x35,
                                        0x28, 0x74, 0x3f, 0x2c, 0x33, 0x36, 0x74, 0x2e, 0x3f,
                                        0x29, 0x2e, 0x75, 0x2a, 0x3b, 0x33, 0x34, 0x3f, 0x36};

__attribute__((noinline)) static void decifra(char *out, const unsigned char *in, int n) {
  for (int i = 0; i < n; i++) out[i] = (char)(in[i] ^ 0x5A);
  out[n] = 0;
}

__attribute__((noinline)) static void usa(const char *s) { OutputDebugStringA(s); }

int main(void) {
  /* Na pilha, caractere por caractere: "stack.evil.test". */
  volatile char pilha[16];
  pilha[0] = 's'; pilha[1] = 't'; pilha[2] = 'a'; pilha[3] = 'c'; pilha[4] = 'k';
  pilha[5] = '.'; pilha[6] = 'e'; pilha[7] = 'v'; pilha[8] = 'i'; pilha[9] = 'l';
  pilha[10] = '.'; pilha[11] = 't'; pilha[12] = 'e'; pilha[13] = 's'; pilha[14] = 't';
  pilha[15] = 0;
  usa((const char *)pilha);
  char claro[64];
  decifra(claro, CIFRADO, sizeof CIFRADO);
  usa(claro);
  return 0;
}
