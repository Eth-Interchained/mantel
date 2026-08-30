/**
 * Pure transforms for the Ollama importer — no network, no I/O.
 *
 * Split out so the parsing and merging logic is unit-testable against
 * captured fixtures. import-ollama.mjs does the fetching and calls these.
 */

/**
 * Turn a registry manifest + config blob into one quant's facts.
 *
 * Throws (rather than returning a half-built row) when the model layer or the
 * quant name is missing — a nameless quant would render as a blank blob in the
 * fit table, worse than skipping the tag. Never sets minVramGib: file size is
 * not a load footprint, so that stays the caller's null.
 */
export function tagFactsFrom(manifest, config) {
  const modelLayer = (manifest.layers || []).find(
    (l) => l.mediaType === "application/vnd.ollama.image.model",
  );
  if (!modelLayer) {
    throw new Error(
      `no model layer — mediaTypes were [${(manifest.layers || [])
        .map((l) => l.mediaType)
        .join(", ")}]`,
    );
  }
  if (!config || !config.file_type) {
    throw new Error("config blob has no file_type (quant name unknown)");
  }
  return {
    quant: String(config.file_type),
    fileGib: Number((modelLayer.size / 1024 ** 3).toFixed(2)),
    params: config.model_type ? String(config.model_type) : undefined,
    arch: config.model_family ? String(config.model_family) : undefined,
  };
}

/**
 * Group seed rows by family so several tags collapse into one catalog entry.
 * Malformed "model" values are dropped from the result and reported, never
 * silently kept as a broken family.
 */
export function groupSeeds(seeds) {
  const byFamily = new Map();
  const skipped = [];
  for (const s of seeds) {
    const parts = typeof s.model === "string" ? s.model.split(":") : [];
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      skipped.push(s.model);
      continue;
    }
    const [family, tag] = parts;
    if (!byFamily.has(family)) byFamily.set(family, { meta: s, tags: [] });
    byFamily.get(family).tags.push(tag);
  }
  return { byFamily, skipped };
}

/**
 * De-duplicate quant rows: two tags can resolve to the same underlying quant
 * (same name + same size). Keeps first occurrence, preserves order.
 */
export function dedupeQuants(quants) {
  const seen = new Set();
  return quants.filter((q) => {
    const k = `${q.name}|${q.fileGib}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Assemble the /api/ingest/model body from a family's merged facts + seed meta.
 * Drops undefined keys so the payload is clean JSON, not null-stuffed.
 */
export function buildEntry(family, defaultTag, meta, quants, params, arch) {
  const id = `${family}:${defaultTag}`;
  const entry = {
    id,
    name: meta.name || family,
    params,
    arch,
    license: meta.license,
    quants,
    tags: meta.tags || [],
    links: meta.hf
      ? { hf: meta.hf, ollama: `https://ollama.com/library/${family}` }
      : { ollama: `https://ollama.com/library/${family}` },
    pull: `hearth pull ${id}`,
    summary: meta.summary,
  };
  for (const k of Object.keys(entry)) if (entry[k] === undefined) delete entry[k];
  return entry;
}
