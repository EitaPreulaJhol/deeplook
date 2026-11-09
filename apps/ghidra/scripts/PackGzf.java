// Empacota o programa ja analisado num .gzf, para abrir no Ghidra local (item 7.3). Roda numa
// segunda passada (-process -noanalysis): na primeira, o programa ainda nao foi gravado no projeto
// quando o script roda, e o pacote sairia vazio ou falharia. Argumento: <projeto.gzf>.
// @category DeepLook
import java.io.File;

import ghidra.app.script.GhidraScript;

public class PackGzf extends GhidraScript {
	@Override
	public void run() throws Exception {
		currentProgram.getDomainFile().packFile(new File(getScriptArgs()[0]), monitor);
	}
}
