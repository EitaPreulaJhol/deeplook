// Exporta para o DeepLook (item 7.3) o resumo da analise do Ghidra: o programa, as funcoes, quem
// chama APIs sensiveis e o pseudo-C dessas funcoes e do ponto de entrada.
// Argumentos: <saida.json> <apis.txt> <ordinais.json>. O projeto .gzf sai numa segunda passada
// (PackGzf.java).
// @category DeepLook
import java.io.File;
import java.io.FileWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.reflect.TypeToken;

import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionIterator;
import ghidra.program.util.CyclomaticComplexity;

public class ExportDeepLook extends GhidraScript {
	/** Funcoes listadas (as maiores); o total vai a parte. */
	private static final int MAX_FUNCTIONS = 300;
	/** Funcoes com pseudo-C (as que mais chamam APIs sensiveis, e o ponto de entrada). */
	private static final int MAX_DECOMPILED = 25;
	private static final int MAX_C_CHARS = 20000;
	private static final int DECOMPILE_TIMEOUT_S = 30;
	private static final int MAX_CALLERS = 10;

	private static final Pattern ORDINAL = Pattern.compile("^Ordinal_(\\d+)$");
	/** Ordinais conhecidos do ws2_32, wsock32 e oleaut32 (a tabela do pefile, a mesma do 7.1). */
	private Map<String, Map<String, String>> ordinals = Map.of();

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

	private static String hex(Address a) {
		return "0x" + a.toString(false);
	}

	@Override
	public void run() throws Exception {
		String[] args = getScriptArgs();
		File out = new File(args[0]);
		Set<String> sensitive = new HashSet<>();
		for (String line : Files.readAllLines(new File(args[1]).toPath(), StandardCharsets.UTF_8)) {
			String name = line.trim();
			if (!name.isEmpty() && !name.startsWith("#")) {
				sensitive.add(name);
			}
		}

		if (args.length > 2) {
			ordinals = new Gson().fromJson(Files.readString(new File(args[2]).toPath()),
				new TypeToken<Map<String, Map<String, String>>>() {}.getType());
		}
		CyclomaticComplexity complexity = new CyclomaticComplexity();
		List<Map<String, Object>> all = new ArrayList<>();
		Map<Function, Set<String>> sensitiveCalls = new LinkedHashMap<>();
		int total = 0;
		int thunks = 0;
		FunctionIterator it = currentProgram.getFunctionManager().getFunctions(true);
		while (it.hasNext() && !monitor.isCancelled()) {
			Function f = it.next();
			if (f.isThunk()) {
				thunks++;
				continue;
			}
			total++;
			Set<String> apis = new TreeSet<>();
			for (Function callee : f.getCalledFunctions(monitor)) {
				String api = externalName(callee);
				if (api != null) {
					apis.add(api);
				}
			}
			Set<String> hits = new TreeSet<>();
			for (String api : apis) {
				// Variantes como CreateProcessA/W e os prefixos _ e __imp_ do MinGW.
				String bare = api.replaceFirst("^(__imp_|_)+", "").replaceFirst("@\\d+$", "");
				if (sensitive.contains(bare)) {
					hits.add(bare);
				}
			}
			if (!hits.isEmpty()) {
				sensitiveCalls.put(f, hits);
			}
			Map<String, Object> row = new LinkedHashMap<>();
			row.put("name", f.getName(true));
			row.put("entry", hex(f.getEntryPoint()));
			row.put("size", f.getBody().getNumAddresses());
			int cc = 0;
			try {
				cc = complexity.calculateCyclomaticComplexity(f, monitor);
			}
			catch (Exception e) {
				cc = -1;
			}
			row.put("complexity", cc);
			row.put("calls", f.getCalledFunctions(monitor).size());
			row.put("callers", f.getCallingFunctions(monitor).size());
			row.put("apis", apis.size() > 40 ? new ArrayList<>(apis).subList(0, 40) : apis);
			all.add(row);
		}
		all.sort(Comparator.comparingLong((Map<String, Object> r) -> (Long) r.get("size")).reversed());

		// Pseudo-C: o ponto de entrada e as funcoes que mais chamam APIs sensiveis.
		List<Function> targets = new ArrayList<>(sensitiveCalls.keySet());
		targets.sort(Comparator.comparingInt((Function f) -> sensitiveCalls.get(f).size()).reversed());
		List<Function> chosen = new ArrayList<>();
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
		if (entryFn != null && !entryFn.isThunk()) {
			chosen.add(entryFn);
		}
		for (Function f : targets) {
			if (chosen.size() >= MAX_DECOMPILED) {
				break;
			}
			if (!chosen.contains(f)) {
				chosen.add(f);
			}
		}

		DecompInterface decompiler = new DecompInterface();
		decompiler.openProgram(currentProgram);
		List<Map<String, Object>> decompiled = new ArrayList<>();
		for (Function f : chosen) {
			if (monitor.isCancelled()) {
				break;
			}
			Map<String, Object> row = new LinkedHashMap<>();
			row.put("name", f.getName(true));
			row.put("entry", hex(f.getEntryPoint()));
			row.put("isEntryPoint", f.equals(entryFn));
			row.put("sensitive", sensitiveCalls.getOrDefault(f, Set.of()));
			List<String> callers = new ArrayList<>();
			for (Function caller : f.getCallingFunctions(monitor)) {
				if (callers.size() >= MAX_CALLERS) {
					break;
				}
				callers.add(caller.getName(true));
			}
			row.put("callers", callers);
			DecompileResults res = decompiler.decompileFunction(f, DECOMPILE_TIMEOUT_S, monitor);
			if (res != null && res.decompileCompleted() && res.getDecompiledFunction() != null) {
				String c = res.getDecompiledFunction().getC();
				row.put("truncated", c.length() > MAX_C_CHARS);
				row.put("c", c.length() > MAX_C_CHARS ? c.substring(0, MAX_C_CHARS) : c);
			}
			else {
				row.put("error", res == null ? "sem resultado" : res.getErrorMessage());
			}
			decompiled.add(row);
		}
		decompiler.dispose();

		Map<String, Object> result = new LinkedHashMap<>();
		result.put("format", currentProgram.getExecutableFormat());
		result.put("language", currentProgram.getLanguageID().getIdAsString());
		result.put("compiler", currentProgram.getCompilerSpec().getCompilerSpecID().getIdAsString());
		result.put("imageBase", hex(currentProgram.getImageBase()));
		result.put("entryPoint", entry != null ? hex(entry) : null);
		result.put("functions", total);
		result.put("thunks", thunks);
		result.put("sensitiveFunctions", sensitiveCalls.size());
		result.put("largest", all.size() > MAX_FUNCTIONS ? all.subList(0, MAX_FUNCTIONS) : all);
		result.put("decompiled", decompiled);

		Gson gson = new GsonBuilder().disableHtmlEscaping().create();
		try (Writer w = new FileWriter(out, StandardCharsets.UTF_8)) {
			gson.toJson(result, w);
		}
	}
}
