// Liga as bases do Function ID montadas no build (plans/analise-estatica-ampliada, item 25) antes da
// analise: as do MinGW-w64 (runtime, libgcc e zlib), alem das do Visual Studio que o Ghidra traz.
//
//   -preScript AttachFid.java <pasta com os .fidb>
//@category DeepLook
import java.io.File;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;

import ghidra.app.script.GhidraScript;
import ghidra.feature.fid.db.FidFileManager;

public class AttachFid extends GhidraScript {
	@Override
	protected void run() throws Exception {
		File dir = new File(getScriptArgs()[0]);
		File[] files = dir.listFiles((d, name) -> name.endsWith(".fidb"));
		if (files == null) {
			return;
		}
		// O Ghidra abre a base com um arquivo de trava ao lado, e a raiz do container e somente
		// leitura: a copia vai para o /tmp (tmpfs).
		File work = new File(System.getProperty("java.io.tmpdir"), "fid");
		work.mkdirs();
		FidFileManager manager = FidFileManager.getInstance();
		for (File f : files) {
			File copy = new File(work, f.getName());
			Files.copy(f.toPath(), copy.toPath(), StandardCopyOption.REPLACE_EXISTING);
			manager.addUserFidFile(copy);
		}
	}
}
