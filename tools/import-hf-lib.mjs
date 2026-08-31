/**
 * Pure transforms for the HuggingFace importer — no network, no I/O.
 *
 * Split out so quant parsing, multi-part merging, and payload building are
 * unit-tested against captured fixtures. import-hf.mjs does the fetching.
 *
 * Same contract as the Ollama importer: registry facts only, minVramGib always
 * null (HF knows file sizes, not load footprints — never invent VRAM).
 */

/**
 * Extract the quant name from a GGUF filename.
 *
 * HF names GGUFs as `<model>-<QUANT>.gguf`, and multi-part ones as
 * `<model>-<QUANT>/<model>-<QUANT>-00001-of-00002.gguf`. The quant token is a
 * known vocabulary — Qn / Qn_K_x / IQn_xxx / F16 / F32 / BF16 — so we match
 * that vocabulary rather than "the last dash segment", which would trip over
 * model names that themselves contain dashes and numbers.
 *
 * Returns the quant string (e.g. "Q4_K_M", "F16") or null when no known quant
 * token is present — the caller skips-with-a-log rather than guessing.
 */
export function parseQuantFromFilename(path) {
  const base = path.split("/").pop() || path;
  // Drop the .gguf extension and any shard suffix (-00001-of-00002).
  const stem = base.replace(/\.gguf$/i, "").replace(/-\d{5}-of-\d{5}$/i, "");
  // Known quant vocabulary, longest-first so Q4_K_M wins over Q4.
  // IQ# imatrix quants, Q#_K_(S|M|L), Q#_(0|1), plain floats.
  const m = stem.match(
    /(?:^|[-_.])(IQ\d+(?:_[A-Z0-9]+)*|Q\d+(?:_[A-Z0-9]+)*|BF16|F16|F32|FP16|FP32)(?:$)/i,
  );
  return m ? m[1].toUpperCase() : null;
}

/**
 * Collapse a repo's GGUF tree into one quant row per quant, summing the bytes
 * of multi-part shards.
 *
 * treeEntries: [{ path, size }] from /tree/main?recursive=true.
 * Returns [{ name, fileGib, minVramGib: null }], sorted by size ascending, with
 * a `skipped` list naming files whose quant could not be parsed.
 */
export function groupGgufsByQuant(treeEntries) {
  const bytes = new Map(); // quant -> summed bytes
  const skipped = [];
  for (const e of treeEntries) {
    if (typeof e.path !== "string" || !e.path.toLowerCase().endsWith(".gguf")) continue;
    const quant = parseQuantFromFilename(e.path);
    if (!quant) {
      skipped.push(e.path);
      continue;
    }
    const size = typeof e.size === "number" ? e.size : 0;
    if (size <= 0) {
      // A GGUF with no size is unusable for a fit table — skip it visibly
      // rather than emitting a 0 GiB quant.
      skipped.push(e.path);
      continue;
    }
    bytes.set(quant, (bytes.get(quant) || 0) + size);
  }
  const quants = [...bytes.entries()]
    .map(([name, b]) => ({ name, fileGib: Number((b / 1024 ** 3).toFixed(2)), minVramGib: null }))
    .sort((a, b) => a.fileGib - b.fileGib);
  return { quants, skipped };
}

/**
 * Format a parameter count (from gguf.total) as a human string like "32.8B".
 * Returns undefined when the count is missing or not a positive number — the
 * field is optional, and a made-up "0B" would be worse than absent.
 */
export function formatParams(total) {
  if (typeof total !== "number" || !Number.isFinite(total) || total <= 0) return undefined;
  const b = total / 1e9;
  if (b >= 1) return `${b.toFixed(b >= 100 ? 0 : 1)}B`;
  const m = total / 1e6;
  return `${m.toFixed(0)}M`;
}

/**
 * Build the /api/ingest/model payload from a repo's HF metadata + parsed quants
 * + the seed row. Registry facts (params/arch/license/context) win; the seed
 * supplies the mantel id (HF repo names are not family:tag shaped) and prose.
 * Drops undefined keys for clean JSON.
 */
export function buildHfEntry(seed, meta, quants) {
  const g = meta && typeof meta.gguf === "object" && meta.gguf ? meta.gguf : {};
  const card = meta && typeof meta.cardData === "object" && meta.cardData ? meta.cardData : {};
  const entry = {
    id: seed.id,
    name: seed.name || seed.id,
    params: formatParams(g.total),
    arch: typeof g.architecture === "string" ? g.architecture : undefined,
    license: seed.license || (typeof card.license === "string" ? card.license : undefined),
    contextNative:
      typeof g.context_length === "number" && g.context_length > 0 ? g.context_length : undefined,
    quants,
    tags: seed.tags || [],
    links: { hf: `https://huggingface.co/${seed.repo}` },
    pull: seed.pull || `hearth pull ${seed.id}`,
    summary: seed.summary,
  };
  for (const k of Object.keys(entry)) if (entry[k] === undefined) delete entry[k];
  return entry;
}

/**
 * Derive a mantel id (family:tag) from an HF repo id, for DISCOVERED repos
 * that have no curated seed row.
 *
 * "bartowski/Meta-Llama-3.1-8B-Instruct-GGUF" -> "meta-llama-3.1-8b-instruct:gguf"
 *
 * Lowercased, the trailing -GGUF stripped (it becomes the :gguf tag), every
 * run of characters outside [a-z0-9._-] collapsed to a single hyphen, and
 * leading/trailing separators trimmed so the result satisfies the catalog's
 * family:tag regex. Returns null when nothing usable survives — the caller
 * skips-with-a-log rather than inventing an id.
 */
export function deriveIdFromRepo(repoId) {
  const base = String(repoId).split("/").pop() || "";
  let family = base
    .toLowerCase()
    .replace(/[-_.]?gguf$/i, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "");
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(family)) return null;
  return `${family}:gguf`;
}

/**
 * Map HF pipeline/library tags to mantel's small tag vocabulary — only the
 * mappings we can defend. A discovered chat model gets "chat"; multimodal
 * gets "vision"; embedding models get "embedding". Coder/reasoning CANNOT be
 * derived from HF tags reliably, so discovered repos never get them — a wrong
 * "coder" tag would seed a ranked feed with junk, which is worse than a
 * missing tag. Curated seeds carry the judgment tags.
 */
export function mapHfTags(hfTags) {
  const t = new Set(Array.isArray(hfTags) ? hfTags : []);
  const out = [];
  if (t.has("image-text-to-text") || t.has("image-to-text") || t.has("visual-question-answering")) {
    out.push("vision");
  }
  if (t.has("sentence-similarity") || t.has("feature-extraction") || t.has("sentence-transformers")) {
    out.push("embedding");
  }
  // Chat only when it is not primarily an embedding model.
  if ((t.has("text-generation") || t.has("conversational")) && !out.includes("embedding")) {
    out.push("chat");
  }
  return out;
}
