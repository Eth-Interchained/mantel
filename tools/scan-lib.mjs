/**
 * Pure transforms for the deterministic signal scanner — no network, no I/O.
 *
 * DESIGN: this scanner is DETERMINISTIC. No LLM sits in the loop. Sentiment
 * comes from a small transparent lexicon; a post that matches no lexicon term
 * is "neutral" — which is honest, because a neutral signal still counts as
 * evidence volume without pretending we inferred a feeling we didn't.
 * (muse-extract can re-grade signals later as a separate, optional pass; the
 * scanner never depends on it.)
 */

/** Words that, appearing in a post about a model, indicate the tone. Small on
 *  purpose — every entry is legible and disputable. Matching is whole-word,
 *  case-insensitive, on title+body. */
export const LEXICON = {
  positive: [
    "great", "excellent", "amazing", "impressive", "best", "love", "loving",
    "fast", "solid", "reliable", "recommend", "recommended", "underrated",
    "beats", "outperforms", "smooth", "perfect", "insane", "incredible",
  ],
  negative: [
    "terrible", "awful", "broken", "crash", "crashes", "unusable", "worst",
    "hallucinate", "hallucinates", "hallucinating", "garbage", "disappointing",
    "disappointed", "overrated", "fails", "failure", "useless", "slow",
    "regression", "worse",
  ],
  /** Hedges that flip a positive/negative mix into "mixed". */
  hedge: ["but", "however", "although", "except", "mixed"],
};

/**
 * Deterministic sentiment from text: count whole-word lexicon hits.
 *   pos>0 and neg>0            -> mixed
 *   pos>0                      -> positive (mixed when a hedge co-occurs)
 *   neg>0                      -> negative
 *   otherwise                  -> neutral
 */
export function gradeText(text) {
  const t = String(text).toLowerCase();
  const hits = (words) =>
    words.reduce((n, w) => n + (new RegExp(`\\b${w}\\b`, "i").test(t) ? 1 : 0), 0);
  const pos = hits(LEXICON.positive);
  const neg = hits(LEXICON.negative);
  const hedged = hits(LEXICON.hedge) > 0;
  if (pos > 0 && neg > 0) return "mixed";
  if (pos > 0) return hedged ? "mixed" : "positive";
  if (neg > 0) return "negative";
  return "neutral";
}

/**
 * Does this post actually talk about the model? Whole-word match on the
 * family name (and the full family:tag id) — "qwen3" must not match "qwen30"
 * or a URL fragment. Families shorter than 4 chars are required to match the
 * FULL id instead, because 3-char names ("phi") false-positive too easily.
 */
export function mentionsModel(text, modelId) {
  const t = String(text).toLowerCase();
  const family = modelId.split(":")[0];
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (family.length >= 4) {
    return new RegExp(`(^|[^a-z0-9])${esc(family)}([^a-z0-9]|$)`, "i").test(t);
  }
  return new RegExp(`(^|[^a-z0-9])${esc(modelId)}([^a-z0-9]|$)`, "i").test(t);
}

/** Reddit search JSON row -> a mantel signal, or null when unusable. */
export function redditToSignal(child, modelId) {
  const d = child && child.data ? child.data : null;
  if (!d || typeof d.permalink !== "string" || typeof d.created_utc !== "number") return null;
  const title = typeof d.title === "string" ? d.title : "";
  const body = typeof d.selftext === "string" ? d.selftext : "";
  const text = `${title}\n${body}`;
  if (!mentionsModel(text, modelId)) return null;
  const excerpt = (title || body).slice(0, 500);
  if (!excerpt) return null;
  return {
    modelRef: modelId,
    source: "reddit",
    sourceUrl: `https://www.reddit.com${d.permalink}`,
    authorHandle: typeof d.author === "string" ? `u/${d.author}` : undefined,
    excerpt,
    sentiment: gradeText(text),
    postedAt: new Date(d.created_utc * 1000).toISOString(),
    _raw: text.slice(0, 20000),
  };
}

/** HN Algolia hit -> a mantel signal, or null when unusable. */
export function hnToSignal(hit, modelId) {
  if (!hit || !hit.objectID || typeof hit.created_at !== "string") return null;
  const title = typeof hit.title === "string" ? hit.title : "";
  const comment = typeof hit.comment_text === "string" ? hit.comment_text : "";
  const story = typeof hit.story_title === "string" ? hit.story_title : "";
  const text = `${title}\n${story}\n${comment}`.replace(/<[^>]+>/g, " ");
  if (!mentionsModel(text, modelId)) return null;
  const excerpt = (title || comment.replace(/<[^>]+>/g, " ") || story).trim().slice(0, 500);
  if (!excerpt) return null;
  return {
    modelRef: modelId,
    source: "hn",
    sourceUrl: `https://news.ycombinator.com/item?id=${hit.objectID}`,
    authorHandle: typeof hit.author === "string" ? hit.author : undefined,
    excerpt,
    sentiment: gradeText(text),
    postedAt: new Date(hit.created_at).toISOString(),
    _raw: text.slice(0, 20000),
  };
}
