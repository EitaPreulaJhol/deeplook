/* DLL de teste: exports por nome, so por ordinal e encaminhado (item 7.1). */
#include <windows.h>

int Alpha(void) { return 1; }
int Beta(void) { return 2; }
void ServiceMain(void) {}
int Hidden(void) { return 7; }

BOOL WINAPI DllMain(HINSTANCE h, DWORD reason, LPVOID reserved) {
  (void)h;
  (void)reason;
  (void)reserved;
  return TRUE;
}
