// Exporta para o DeepLook (item 7.3) o resumo da analise do Ghidra: o programa, as funcoes, quem
// chama APIs sensiveis e o pseudo-C dessas funcoes e do ponto de entrada. Com os tres ultimos
// argumentos, exporta tambem o pseudo-C de todas as funcoes, ate o prazo (plans/ghidra-pseudo-c).
// Argumentos: <saida.json> <apis.txt> <ordinais.json> [<pseudo.json> <prazo> <teto>], com o prazo
// em milissegundos desde 1970 e o teto em bytes de pseudo-C (UTF-8). O projeto .gzf sai numa
// segunda passada (PackGzf.java).
// @category DeepLook
import java.io.File;
import java.io.FileWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.reflect.TypeToken;

import ghidra.app.decompiler.DecompileResults;
import ghidra.app.decompiler.parallel.DecompilerCallback;
import ghidra.app.decompiler.parallel.ParallelDecompiler;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.BookmarkType;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionIterator;
import ghidra.program.util.CyclomaticComplexity;
import ghidra.util.task.TaskMonitor;

public class ExportDeepLook extends GhidraScript {
	/** Funcoes listadas no resumo (as maiores); o total vai a parte. */
	private static final int MAX_FUNCTIONS = 300;
	/** Funcoes com pseudo-C no resumo (as que mais chamam APIs sensiveis, e o ponto de entrada). */
	private static final int MAX_DECOMPILED = 25;
	/** Pseudo-C de cada funcao no resumo. */
	private static final int MAX_C_CHARS = 20000;
	private static final int DECOMPILE_TIMEOUT_S = 30;
	private static final int MAX_CALLERS = 10;
	private static final int MAX_ERROR_CHARS = 1000;
	/** Pseudo-C completo (fase 0 do plano: medido em ate 2870 funcoes e 207 mil caracteres). */
	private static final int MAX_PSEUDO_FUNCTIONS = 20000;
	private static final int MAX_PSEUDO_CHARS = 256_000;
	/** Chamadores e chamadas de cada funcao no pseudo-C completo (enderecos, para navegar). */
	private static final int MAX_LINKS = 50;

	private static final Pattern ORDINAL = Pattern.compile("^Ordinal_(\\d+)$");
	/** Ordinais conhecidos do ws2_32, wsock32 e oleaut32 (a tabela do pefile, a mesma do 7.1). */
	private Map<String, Map<String, String>> ordinals = Map.of();

	/** O que se sabe de cada funcao antes de descompilar. */
	private static final class Info {
		Function fn;
		long size;
		int complexity;
		int calls;
		Set<String> apis;
		Set<String> sensitive;
		/** Reconhecida pelo FunctionID como funcao de biblioteca (CRT, MSVC...). */
		boolean library;
		/** Funcoes internas (sem thunks) que esta chama e que a chamam. */
		Set<Function> callees;
		Set<Function> callers;
		int callerCount;
	}

	/** Resultado da descompilacao: o pseudo-C, o erro do descompilador ou por que foi pulada. */
	private static final class Result {
		final Function fn;
		String c;
		String error;
		/** "deadline" (passou do prazo) ou "cap" (passou do teto total). */
		String skipped;

		Result(Function fn) {
			this.fn = fn;
		}
	}

	/**
	 * Nome da API externa que a funcao chama (atravessa thunks), ou null. Importacao por ordinal
	 * (Ordinal_23 do ws2_32, comum em malware) vira o nome pela tabela: o Ghidra nao a traz.
	 */
	private String externalName(Function callee) {
		Function target = callee.isThunk() ? callee.getThunkedFunction(true) : callee;
		if (target == null || !target.isExternal()) {
			return null;
		}
		String name = target.getName();
		Matcher m = ORDINAL.matcher(name);
		if (m.matches() && target.getExternalLocation() != null) {
			String lib = target.getExternalLocation().getLibraryName().toLowerCase();
			Map<String, String> table = ordinals.get(lib.endsWith(".dll") ? lib : lib + ".dll");
			if (table != null && table.containsKey(m.group(1))) {
				return table.get(m.group(1));
			}
		}
		return name;
	}

	/** Funcao interna de verdade por tras de uma chamada (atravessa thunks), ou null. */
	private static Function internal(Function f) {
		Function target = f.isThunk() ? f.getThunkedFunction(true) : f;
		return target == null || target.isExternal() || target.isThunk() ? null : target;
	}

	/** Funcoes reconhecidas pelo Function ID e de que biblioteca (item 25). */
	private int libraryFunctions = 0;
	private final Map<String, Integer> libraries = new HashMap<>();
	private static final Pattern FID_LIBRARY = Pattern.compile("Library: ([^\\r\\n]{1,120})");

	/** A biblioteca que o Function ID anotou no comentario da funcao ("Library: zlib 1.3.1 ..."). */
	private String libraryOf(Function f) {
		String plate = f.getComment();
		if (plate == null) {
			plate = currentProgram.getListing().getComment(ghidra.program.model.listing.CodeUnit.PLATE_COMMENT, f.getEntryPoint());
		}
		if (plate == null) {
			return null;
		}
		Matcher m = FID_LIBRARY.matcher(plate);
		return m.find() ? m.group(1).trim() : null;
	}

	private boolean isLibrary(Function f) {
		var bookmarks = currentProgram.getBookmarkManager();
		Address a = f.getEntryPoint();
		return bookmarks.getBookmark(a, BookmarkType.ANALYSIS, "Function ID Analyzer") != null ||
			bookmarks.getBookmark(a, BookmarkType.ANALYSIS, "Function ID Conflict") != null;
	}

	private static String hex(Address a) {
		return "0x" + a.toString(false);
	}

	/** Corta sem partir um par de surrogates (viraria um caractere invalido no JSON). */
	private static String cut(String s, int max) {
		if (s.length() <= max) {
			return s;
		}
		int end = Character.isHighSurrogate(s.charAt(max - 1)) ? max - 1 : max;
		return s.substring(0, end);
	}

	private static List<String> addresses(Set<Function> fns) {
		List<String> out = new ArrayList<>();
		for (Function f : fns) {
			if (out.size() >= MAX_LINKS) {
				break;
			}
			out.add(hex(f.getEntryPoint()));
		}
		return out;
	}

	@Override
	public void run() throws Exception {
		String[] args = getScriptArgs();
		File out = new File(args[0]);
		Set<String> sensitiveApis = new HashSet<>();
		for (String line : Files.readAllLines(new File(args[1]).toPath(), StandardCharsets.UTF_8)) {
			String name = line.trim();
			if (!name.isEmpty() && !name.startsWith("#")) {
				sensitiveApis.add(name);
			}
		}
		if (args.length > 2) {
			ordinals = new Gson().fromJson(Files.readString(new File(args[2]).toPath()),
				new TypeToken<Map<String, Map<String, String>>>() {}.getType());
		}
		File pseudoOut = args.length > 5 ? new File(args[3]) : null;
		long deadline = pseudoOut != null ? Long.parseLong(args[4]) : Long.MAX_VALUE;
		long capBytes = pseudoOut != null ? Long.parseLong(args[5]) : 0;

		CyclomaticComplexity complexity = new CyclomaticComplexity();
		List<Info> infos = new ArrayList<>();
		int thunks = 0;
		FunctionIterator it = currentProgram.getFunctionManager().getFunctions(true);
		while (it.hasNext() && !monitor.isCancelled()) {
			Function f = it.next();
			if (f.isThunk()) {
				thunks++;
				continue;
			}
			Info info = new Info();
			info.fn = f;
			info.size = f.getBody().getNumAddresses();
			info.apis = new TreeSet<>();
			info.callees = new LinkedHashSet<>();
			Set<Function> called = f.getCalledFunctions(monitor);
			info.calls = called.size();
			for (Function callee : called) {
				String api = externalName(callee);
				if (api != null) {
					info.apis.add(api);
				}
				Function target = internal(callee);
				if (target != null && !target.equals(f)) {
					info.callees.add(target);
				}
			}
			info.sensitive = new TreeSet<>();
			for (String api : info.apis) {
				// Variantes como CreateProcessA/W e os prefixos _ e __imp_ do MinGW.
				String bare = api.replaceFirst("^(__imp_|_)+", "").replaceFirst("@\\d+$", "");
				if (sensitiveApis.contains(bare)) {
					info.sensitive.add(bare);
				}
			}
			Set<Function> calling = f.getCallingFunctions(monitor);
			info.callerCount = calling.size();
			info.callers = new LinkedHashSet<>();
			for (Function caller : calling) {
				if (!caller.isThunk() && !caller.equals(f)) {
					info.callers.add(caller);
				}
			}
			try {
				info.complexity = complexity.calculateCyclomaticComplexity(f, monitor);
			}
			catch (Exception e) {
				info.complexity = -1;
			}
			info.library = isLibrary(f);
			if (info.library) {
				libraryFunctions++;
				String lib = libraryOf(f);
				if (lib != null) {
					libraries.merge(lib, 1, Integer::sum);
				}
			}
			infos.add(info);
		}
		Map<Function, Info> byFn = new HashMap<>();
		for (Info info : infos) {
			byFn.put(info.fn, info);
		}

		// Ponto de entrada: a funcao "entry" (PE e ELF); senao, o primeiro ponto de entrada externo
		// (que num PE tambem pode ser um TLS callback ou um export).
		Address entry = null;
		for (Address a : currentProgram.getSymbolTable().getExternalEntryPointIterator()) {
			Function f = getFunctionAt(a);
			if (entry == null || (f != null && f.getName().equals("entry"))) {
				entry = a;
			}
		}
		Function entryFn = entry != null ? getFunctionAt(entry) : null;

		// Pseudo-C do resumo: o ponto de entrada e as funcoes que mais chamam APIs sensiveis.
		List<Info> bySensitive = new ArrayList<>();
		for (Info info : infos) {
			if (!info.sensitive.isEmpty()) {
				bySensitive.add(info);
			}
		}
		bySensitive.sort(Comparator.comparingInt((Info i) -> i.sensitive.size()).reversed());
		Set<Function> chosen = new LinkedHashSet<>();
		if (entryFn != null && !entryFn.isThunk()) {
			chosen.add(entryFn);
		}
		for (Info info : bySensitive) {
			if (chosen.size() >= MAX_DECOMPILED) {
				break;
			}
			chosen.add(info.fn);
		}

		// Ordem do pseudo-C completo: as do resumo, as demais que chamam APIs sensiveis, as outras
		// pela ordem de tamanho e as de biblioteca por ultimo. O que o prazo cortar e o que menos
		// interessa.
		Set<Function> order = new LinkedHashSet<>(chosen);
		if (pseudoOut != null) {
			for (Info info : bySensitive) {
				if (!info.library) {
					order.add(info.fn);
				}
			}
			List<Info> rest = new ArrayList<>(infos);
			rest.sort(Comparator.comparing((Info i) -> i.library)
				.thenComparing(Comparator.comparingLong((Info i) -> i.size).reversed()));
			for (Info info : rest) {
				if (order.size() >= MAX_PSEUDO_FUNCTIONS) {
					break;
				}
				order.add(info.fn);
			}
		}

		// Uma passada so, em paralelo (2,3 a 2,8 vezes mais rapido que em serie na fase 0). As do
		// resumo descompilam mesmo depois do prazo, como antes: o resumo nao pode sair sem elas.
		Map<Function, Result> results = new ConcurrentHashMap<>();
		AtomicBoolean deadlineHit = new AtomicBoolean();
		AtomicBoolean capHit = new AtomicBoolean();
		long[] usedBytes = { 0 };
		DecompilerCallback<Result> callback =
			new DecompilerCallback<Result>(currentProgram, decompiler -> {}) {
				@Override
				public Result process(Function f, TaskMonitor m) throws Exception {
					if (!chosen.contains(f)) {
						if (capHit.get()) {
							Result r = new Result(f);
							r.skipped = "cap";
							return r;
						}
						if (System.currentTimeMillis() > deadline) {
							deadlineHit.set(true);
							Result r = new Result(f);
							r.skipped = "deadline";
							return r;
						}
					}
					// Uma funcao que derruba o descompilador nao leva as outras junto.
					try {
						return super.process(f, m);
					}
					catch (Exception e) {
						Result r = new Result(f);
						r.error = cut(String.valueOf(e), MAX_ERROR_CHARS);
						return r;
					}
				}

				@Override
				public Result process(DecompileResults res, TaskMonitor m) {
					Result r = new Result(res.getFunction());
					if (res.decompileCompleted() && res.getDecompiledFunction() != null) {
						r.c = res.getDecompiledFunction().getC();
					}
					else {
						String msg = res.getErrorMessage();
						r.error = msg == null || msg.isBlank() ? "sem resultado"
								: cut(msg.trim(), MAX_ERROR_CHARS);
					}
					return r;
				}
			};
		callback.setTimeout(DECOMPILE_TIMEOUT_S);
		try {
			ParallelDecompiler.decompileFunctions(callback, currentProgram, order.iterator(), r -> {
				// O teto total conta o que entra no arquivo; as do resumo nao contam (ja cabiam antes).
				if (r.c != null && pseudoOut != null && !chosen.contains(r.fn)) {
					String c = cut(r.c, MAX_PSEUDO_CHARS);
					long bytes = c.getBytes(StandardCharsets.UTF_8).length;
					synchronized (usedBytes) {
						if (usedBytes[0] + bytes > capBytes) {
							capHit.set(true);
							r.c = null;
							r.skipped = "cap";
						}
						else {
							usedBytes[0] += bytes;
						}
					}
				}
				results.put(r.fn, r);
			}, monitor);
		}
		finally {
			callback.dispose();
		}

		List<Map<String, Object>> decompiled = new ArrayList<>();
		for (Function f : chosen) {
			Info info = byFn.get(f);
			Result res = results.get(f);
			Map<String, Object> row = new LinkedHashMap<>();
			row.put("name", f.getName(true));
			row.put("entry", hex(f.getEntryPoint()));
			row.put("isEntryPoint", f.equals(entryFn));
			row.put("sensitive", info != null ? info.sensitive : Set.of());
			List<String> callers = new ArrayList<>();
			for (Function caller : f.getCallingFunctions(monitor)) {
				if (callers.size() >= MAX_CALLERS) {
					break;
				}
				callers.add(caller.getName(true));
			}
			row.put("callers", callers);
			if (res != null && res.c != null) {
				row.put("truncated", res.c.length() > MAX_C_CHARS);
				row.put("c", cut(res.c, MAX_C_CHARS));
			}
			else {
				row.put("error", res == null || res.error == null ? "sem resultado" : res.error);
			}
			decompiled.add(row);
		}

		List<Map<String, Object>> all = new ArrayList<>();
		for (Info info : infos) {
			Map<String, Object> row = new LinkedHashMap<>();
			row.put("name", info.fn.getName(true));
			row.put("entry", hex(info.fn.getEntryPoint()));
			row.put("size", info.size);
			row.put("complexity", info.complexity);
			row.put("calls", info.calls);
			row.put("callers", info.callerCount);
			row.put("apis", info.apis.size() > 40 ? new ArrayList<>(info.apis).subList(0, 40) : info.apis);
			all.add(row);
		}
		all.sort(Comparator.comparingLong((Map<String, Object> r) -> (Long) r.get("size")).reversed());

		Map<String, Object> result = new LinkedHashMap<>();
		result.put("format", currentProgram.getExecutableFormat());
		result.put("language", currentProgram.getLanguageID().getIdAsString());
		result.put("compiler", currentProgram.getCompilerSpec().getCompilerSpecID().getIdAsString());
		result.put("imageBase", hex(currentProgram.getImageBase()));
		result.put("entryPoint", entry != null ? hex(entry) : null);
		result.put("functions", infos.size());
		result.put("thunks", thunks);
		result.put("libraryFunctions", libraryFunctions);
		List<Map<String, Object>> libs = new ArrayList<>();
		libraries.entrySet().stream()
			.sorted((a, b) -> b.getValue() - a.getValue())
			.limit(30)
			.forEach(e -> {
				Map<String, Object> row = new LinkedHashMap<>();
				row.put("name", cut(e.getKey(), 120));
				row.put("functions", e.getValue());
				libs.add(row);
			});
		result.put("libraries", libs);
		result.put("sensitiveFunctions", bySensitive.size());
		result.put("largest", all.size() > MAX_FUNCTIONS ? all.subList(0, MAX_FUNCTIONS) : all);
		result.put("decompiled", decompiled);

		Gson gson = new GsonBuilder().disableHtmlEscaping().create();
		try (Writer w = new FileWriter(out, StandardCharsets.UTF_8)) {
			gson.toJson(result, w);
		}
		if (pseudoOut == null) {
			return;
		}

		// O resumo ja esta gravado: uma falha daqui em diante so tira o pseudo-C completo.
		try {
			List<Map<String, Object>> rows = new ArrayList<>();
			for (Function f : order) {
				Info info = byFn.get(f);
				Result res = results.get(f);
				Map<String, Object> row = new LinkedHashMap<>();
				row.put("name", f.getName(true));
				row.put("entry", hex(f.getEntryPoint()));
				row.put("size", info.size);
				row.put("complexity", info.complexity);
				row.put("isEntryPoint", f.equals(entryFn));
				row.put("library", info.library);
				row.put("sensitive", info.sensitive);
				row.put("apis", info.apis.size() > 40 ? new ArrayList<>(info.apis).subList(0, 40) : info.apis);
				row.put("callers", addresses(info.callers));
				row.put("callerCount", info.callers.size());
				row.put("callees", addresses(info.callees));
				row.put("calleeCount", info.callees.size());
				if (res != null && res.c != null) {
					row.put("truncated", res.c.length() > MAX_PSEUDO_CHARS);
					row.put("c", cut(res.c, MAX_PSEUDO_CHARS));
				}
				else if (res != null && res.skipped != null) {
					row.put("skipped", res.skipped);
				}
				else {
					row.put("error", res == null || res.error == null ? "sem resultado" : res.error);
				}
				rows.add(row);
			}
			Map<String, Object> pseudo = new LinkedHashMap<>();
			pseudo.put("total", infos.size());
			pseudo.put("deadlineHit", deadlineHit.get());
			pseudo.put("capHit", capHit.get());
			pseudo.put("functions", rows);
			try (Writer w = new FileWriter(pseudoOut, StandardCharsets.UTF_8)) {
				gson.toJson(pseudo, w);
			}
		}
		catch (Exception e) {
			printerr("pseudo-C completo: " + e);
			pseudoOut.delete();
		}
	}
}
