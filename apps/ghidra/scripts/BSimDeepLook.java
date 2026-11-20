// BSim (plans/analise-estatica-ampliada, item 23): funcoes parecidas em outras amostras.
//
//   -postScript BSimDeepLook.java <base, sem a extensao> <saida.json> <sha256 da amostra> <prazo ms>
//     [sha256,sha256,... das amostras apagadas, que saem da base antes]
//
// Numa base H2 em arquivo (no volume do servico), uma por instalacao:
//   1. as funcoes do autor (fora as de biblioteca do Function ID e as muito pequenas) sao consultadas
//      (QueryNearest): parecidas de outras amostras, com a similaridade e a confianca;
//   2. as assinaturas anteriores da mesma amostra saem (reanalise nao duplica);
//   3. as desta amostra entram, com o SHA-256 como nome do executavel (a API liga a amostra por ele).
//@category DeepLook
import java.io.File;
import java.io.FileWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.google.gson.Gson;

import ghidra.app.script.GhidraScript;
import ghidra.features.bsim.query.BSimClientFactory;
import ghidra.features.bsim.query.BSimServerInfo;
import ghidra.features.bsim.query.FunctionDatabase;
import ghidra.features.bsim.query.GenSignatures;
import ghidra.features.bsim.query.description.DatabaseInformation;
import ghidra.features.bsim.query.description.DescriptionManager;
import ghidra.features.bsim.query.description.ExecutableRecord;
import ghidra.features.bsim.query.description.FunctionDescription;
import ghidra.features.bsim.query.protocol.CreateDatabase;
import ghidra.features.bsim.query.protocol.ExeSpecifier;
import ghidra.features.bsim.query.protocol.InsertRequest;
import ghidra.features.bsim.query.protocol.QueryDelete;
import ghidra.features.bsim.query.protocol.QueryNearest;
import ghidra.features.bsim.query.protocol.ResponseNearest;
import ghidra.features.bsim.query.protocol.SimilarityNote;
import ghidra.features.bsim.query.protocol.SimilarityResult;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.BookmarkType;
import ghidra.program.model.listing.Function;

public class BSimDeepLook extends GhidraScript {
	private static final int MIN_BYTES = 48;
	private static final int MAX_QUERY = 400;
	private static final int MAX_INSERT = 5000;
	private static final int MATCHES_PER_FUNC = 5;
	private static final double SIMILARITY = 0.75;
	private static final double SIGNIFICANCE = 10.0;

	private boolean isLibrary(Function f) {
		var bookmarks = currentProgram.getBookmarkManager();
		Address a = f.getEntryPoint();
		return bookmarks.getBookmark(a, BookmarkType.ANALYSIS, "Function ID Analyzer") != null ||
			bookmarks.getBookmark(a, BookmarkType.ANALYSIS, "Function ID Conflict") != null;
	}

	@Override
	protected void run() throws Exception {
		String[] args = getScriptArgs();
		String dbPath = args[0];
		File out = new File(args[1]);
		String sha256 = args[2];
		long deadline = Long.parseLong(args[3]);
		Map<String, Object> result = new LinkedHashMap<>();
		List<Function> mine = new ArrayList<>();
		for (Function f : currentProgram.getFunctionManager().getFunctions(true)) {
			if (!f.isThunk() && !f.isExternal() && !isLibrary(f) &&
				f.getBody().getNumAddresses() >= MIN_BYTES) {
				mine.add(f);
			}
		}
		mine.sort(Comparator.comparingLong((Function f) -> f.getBody().getNumAddresses()).reversed());
		BSimServerInfo info = new BSimServerInfo(dbPath);
		boolean fresh = !new File(dbPath + BSimServerInfo.H2_FILE_EXTENSION).exists();
		try (FunctionDatabase db = BSimClientFactory.buildClient(info, false)) {
			if (fresh) {
				CreateDatabase create = new CreateDatabase();
				create.info = new DatabaseInformation();
				create.info.databasename = "deeplook";
				create.config_template = "medium_nosize";
				create.info.trackcallgraph = true;
				if (create.execute(db) == null) {
					throw new Exception("criar a base BSim: " + db.getLastError().message);
				}
			}
			if (!db.initialize()) {
				throw new Exception("abrir a base BSim: " + db.getLastError().message);
			}
			String md5 = currentProgram.getExecutableMD5();

			// 0. As amostras apagadas de vez na DeepLook saem da base (pelo nome, que e o SHA-256).
			List<String> deleted = new ArrayList<>();
			if (args.length > 4 && !args[4].isEmpty()) {
				for (String gone : args[4].split(",")) {
					if (!gone.matches("[0-9a-f]{64}") || gone.equals(sha256)) {
						continue;
					}
					QueryDelete drop = new QueryDelete();
					ExeSpecifier which = new ExeSpecifier();
					which.exename = gone;
					drop.exelist.add(which);
					drop.execute(db);
					deleted.add(gone);
				}
			}
			result.put("deleted", deleted);

			// 1. Consulta, antes de inserir (a propria amostra nao aparece).
			List<Map<String, Object>> matches = new ArrayList<>();
			Map<String, Integer> shared = new HashMap<>();
			GenSignatures query = new GenSignatures(false);
			try {
				query.setVectorFactory(db.getLSHVectorFactory());
				query.openProgram(currentProgram, sha256, null, null, null, null);
				int n = 0;
				for (Function f : mine) {
					if (n++ >= MAX_QUERY || System.currentTimeMillis() > deadline) {
						break;
					}
					query.scanFunction(f);
				}
				DescriptionManager manager = query.getDescriptionManager();
				if (manager.numFunctions() > 0) {
					QueryNearest near = new QueryNearest();
					near.manage = manager;
					near.max = MATCHES_PER_FUNC;
					near.thresh = SIMILARITY;
					near.signifthresh = SIGNIFICANCE;
					ResponseNearest response = near.execute(db);
					if (response != null) {
						for (SimilarityResult sim : response.result) {
							FunctionDescription base = sim.getBase();
							List<Map<String, Object>> others = new ArrayList<>();
							Iterator<SimilarityNote> it = sim.iterator();
							while (it.hasNext()) {
								SimilarityNote note = it.next();
								FunctionDescription other = note.getFunctionDescription();
								ExecutableRecord exe = other.getExecutableRecord();
								if (exe.getMd5().equals(md5) || exe.getNameExec().equals(sha256)) {
									continue;
								}
								Map<String, Object> row = new LinkedHashMap<>();
								row.put("sha256", exe.getNameExec());
								row.put("function", other.getFunctionName());
								row.put("address", "0x" + Long.toHexString(other.getAddress()));
								row.put("similarity", Math.round(note.getSimilarity() * 1000) / 1000.0);
								row.put("significance", Math.round(note.getSignificance() * 10) / 10.0);
								others.add(row);
							}
							if (!others.isEmpty()) {
								Map<String, Object> item = new LinkedHashMap<>();
								item.put("function", base.getFunctionName());
								item.put("address", "0x" + Long.toHexString(base.getAddress()));
								item.put("matches", others);
								matches.add(item);
								others.stream().map(o -> (String) o.get("sha256")).distinct()
									.forEach(s -> shared.merge(s, 1, Integer::sum));
							}
						}
					}
				}
			}
			finally {
				query.dispose();
			}

			// 2. Tira o que havia desta amostra e 3. grava as assinaturas de agora.
			QueryDelete delete = new QueryDelete();
			ExeSpecifier spec = new ExeSpecifier();
			spec.exemd5 = md5;
			delete.exelist.add(spec);
			delete.execute(db);
			int inserted = 0;
			if (System.currentTimeMillis() < deadline) {
				DatabaseInformation dbInfo = db.getInfo();
				GenSignatures gen = new GenSignatures(dbInfo.trackcallgraph);
				try {
					gen.setVectorFactory(db.getLSHVectorFactory());
					gen.addExecutableCategories(dbInfo.execats);
					gen.addFunctionTags(dbInfo.functionTags);
					gen.addDateColumnName(dbInfo.dateColumnName);
					gen.openProgram(currentProgram, sha256, null, null, null, null);
					List<Function> insert = mine.size() > MAX_INSERT ? mine.subList(0, MAX_INSERT) : mine;
					gen.scanFunctions(insert.iterator(), insert.size(), monitor);
					DescriptionManager manager = gen.getDescriptionManager();
					manager.listAllFunctions().forEachRemaining(fd -> fd.sortCallgraph());
					if (manager.numFunctions() > 0) {
						InsertRequest req = new InsertRequest();
						req.manage = manager;
						if (req.execute(db) == null) {
							throw new Exception("gravar na base BSim: " + db.getLastError().message);
						}
						inserted = manager.numFunctions();
					}
				}
				finally {
					gen.dispose();
				}
			}
			result.put("queried", Math.min(mine.size(), MAX_QUERY));
			result.put("inserted", inserted);
			List<Map<String, Object>> sharedList = new ArrayList<>();
			shared.entrySet().stream().sorted((a, b) -> b.getValue() - a.getValue()).limit(50)
				.forEach(e -> {
					Map<String, Object> row = new LinkedHashMap<>();
					row.put("sha256", e.getKey());
					row.put("functions", e.getValue());
					sharedList.add(row);
				});
			result.put("shared", sharedList);
			result.put("matches", matches.size() > 300 ? matches.subList(0, 300) : matches);
		}
		try (Writer w = new FileWriter(out, StandardCharsets.UTF_8)) {
			w.write(new Gson().toJson(result));
		}
	}
}
