// Assembly .NET de teste (item 7.1): P/Invoke, carga de assembly em memoria e versao.
using System;
using System.Reflection;
using System.Runtime.InteropServices;

[assembly: AssemblyVersion("1.2.3.4")]
[assembly: AssemblyTitle("Teste DeepLook")]

namespace Teste {
  public class Carregador {
    [DllImport("kernel32.dll")]
    static extern IntPtr VirtualAlloc(IntPtr a, UIntPtr s, uint t, uint p);
    [DllImport("kernel32.dll", EntryPoint = "CreateThread")]
    static extern IntPtr NovaThread(IntPtr a, uint s, IntPtr f, IntPtr p, uint c, IntPtr id);
    [DllImport("user32")]
    static extern short GetAsyncKeyState(int k);

    public static int Main(string[] args) {
      if (args.Length > 100) {
        Assembly.Load(Convert.FromBase64String(args[0]));
        VirtualAlloc(IntPtr.Zero, UIntPtr.Zero, 0x3000, 0x40);
        NovaThread(IntPtr.Zero, 0, IntPtr.Zero, IntPtr.Zero, 0, IntPtr.Zero);
        GetAsyncKeyState(0x41);
      }
      Console.WriteLine("http://dotnet.evil.test/c2");
      return 0;
    }
  }
}
