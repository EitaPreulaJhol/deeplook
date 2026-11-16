// Analise mais leve em binarios grandes (plans/ajustes-usabilidade, item 2). Roda antes da analise
// automatica (-preScript) e desliga os analisadores passados como argumento. O de switch
// ("Decompiler Switch Analysis") descompila cada funcao com salto indireto: no python3.13 (6,8 MB),
// a analise automatica caiu de 455 s para 108 s sem ele. Perde-se o codigo alcancado so por tabelas
// de salto (no perl, 3% das funcoes; no python3.13, 2%).
// @category DeepLook
import ghidra.app.script.GhidraScript;

public class LightAnalysis extends GhidraScript {
	@Override
	public void run() throws Exception {
		for (String analyzer : getScriptArgs()) {
			setAnalysisOption(currentProgram, analyzer, "false");
		}
	}
}
