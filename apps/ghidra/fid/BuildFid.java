// Monta uma base do Function ID sem a interface (plans/analise-estatica-ampliada, item 25): o que o
// CreateMultipleLibraries faz pelos dialogos, por argumento. Roda no build (fid/build.sh), sobre um
// projeto em que os objetos de cada biblioteca ja foram importados e analisados com os scripts
// FunctionIDHeadlessPrescript/Postscript do Ghidra, uma pasta por biblioteca.
//
//   BuildFid.java <arquivo.fidb> <idioma> <pasta>=<nome>:<versao>:<variante> ...
//@category DeepLook
import java.io.File;
import java.util.ArrayList;
import java.util.List;

import ghidra.app.script.GhidraScript;
import ghidra.feature.fid.db.FidDB;
import ghidra.feature.fid.db.FidFile;
import ghidra.feature.fid.db.FidFileManager;
import ghidra.feature.fid.service.FidPopulateResult;
import ghidra.feature.fid.service.FidService;
import ghidra.framework.model.DomainFile;
import ghidra.framework.model.DomainFolder;
import ghidra.program.database.ProgramContentHandler;
import ghidra.util.task.TaskMonitor;

public class BuildFid extends GhidraScript {

	private void collect(DomainFolder folder, List<DomainFile> out) {
		for (DomainFile f : folder.getFiles()) {
			if (f.getContentType().equals(ProgramContentHandler.PROGRAM_CONTENT_TYPE)) {
				out.add(f);
			}
		}
		for (DomainFolder sub : folder.getFolders()) {
			collect(sub, out);
		}
	}

	@Override
	protected void run() throws Exception {
		String[] args = getScriptArgs();
		File dbFile = new File(args[0]);

		FidFileManager manager = FidFileManager.getInstance();
		if (!dbFile.exists()) {
			manager.createNewFidDatabase(dbFile);
		}
		FidFile fidFile = manager.addUserFidFile(dbFile);
		FidService service = new FidService();
		FidDB db = fidFile.getFidDB(true);
		try {
			DomainFolder root = state.getProject().getProjectData().getRootFolder();
			for (int i = 2; i < args.length; i++) {
				String[] spec = args[i].split("=", 2);
				String[] lib = spec[1].split(":", 3);
				DomainFolder folder = root;
				for (String part : spec[0].split("/")) {
					if (!part.isEmpty()) {
						folder = folder.getFolder(part);
					}
				}
				if (folder == null) {
					printerr("pasta ausente: " + spec[0]);
					continue;
				}
				List<DomainFile> programs = new ArrayList<>();
				collect(folder, programs);
				FidPopulateResult result = service.createNewLibraryFromPrograms(db, lib[0], lib[1],
					lib[2], programs, null, new ghidra.feature.fid.db.FidFilter(args[1], "", ""),
					null, null, TaskMonitor.DUMMY);
				int added = result.getTotalAdded();
				println("FID " + lib[0] + " " + lib[1] + " " + lib[2] + ": " + programs.size() +
					" objetos, " + added + " funcoes");
			}
			db.saveDatabase("DeepLook", TaskMonitor.DUMMY);
		}
		finally {
			db.close();
		}
	}
}
