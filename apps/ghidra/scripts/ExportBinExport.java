// O .BinExport da amostra (plans/analise-estatica-ampliada, item 24), para o BinDiff comparar duas
// amostras analisadas. A extensao BinExport (Apache-2.0, Google) e compilada no build da imagem. O
// script nao importa a classe dela (os scripts sao pacotes OSGi a parte): acha o exportador entre os
// instalados, pelo nome.
//
//   -postScript ExportBinExport.java <saida.BinExport>
//@category DeepLook
import java.io.File;

import ghidra.app.script.GhidraScript;
import ghidra.app.util.exporter.Exporter;
import ghidra.util.classfinder.ClassSearcher;

public class ExportBinExport extends GhidraScript {
	@Override
	protected void run() throws Exception {
		File out = new File(getScriptArgs()[0]);
		for (Exporter exporter : ClassSearcher.getInstances(Exporter.class)) {
			if (exporter.getClass().getName().endsWith(".BinExportExporter")) {
				if (!exporter.export(out, currentProgram, currentProgram.getMemory(), monitor)) {
					throw new Exception("o BinExport falhou");
				}
				return;
			}
		}
		throw new Exception("a extensao BinExport nao esta instalada");
	}
}
