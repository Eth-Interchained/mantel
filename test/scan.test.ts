/**
 * Scanner transform suite — deterministic grading and matching, pinned.
 *
 * The scanner's whole warrant is determinism: same post, same verdict,
 * forever. These tests hold the lexicon grading, the whole-word model
 * matching (the false-positive guard), and the source-row parsing on
 * captured API shapes.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

// @ts-expect-error — plain ESM helper module, no d.ts, intentional.
import {
  decodeEntities,
  gradeText,
  hnToSignal,
  mentionsModel,
  redditToSignal,
} from "../tools/scan-lib.mjs";

test("decodeEntities fixes the exact artifact seen on production", () => {
  // Captured from the live wire: HN comment_text ships hex entities.
  assert.equal(
    decodeEntities("https:&#x2F;&#x2F;docs.ollama.com&#x2F;context-length"),
    "https://docs.ollama.com/context-length",
  );
  assert.equal(decodeEntities("I&#x27;ve had &quot;fun&quot;"), 'I\'ve had "fun"');
  assert.equal(decodeEntities("&gt; quoted &amp; done"), "> quoted & done");
  assert.equal(decodeEntities("a &#8211; b"), "a – b", "decimal refs decode too");
});

test("decodeEntities decodes exactly one level — &amp;lt; is a literal <-entity", () => {
  // Someone WRITING about HTML escaping must not have their text mangled:
  // "&amp;lt;" is the author showing the string "&lt;", not a "<".
  assert.equal(decodeEntities("&amp;lt;"), "&lt;");
});

test("decodeEntities leaves unknown entities alone rather than guessing", () => {
  assert.equal(decodeEntities("&bogus; stays"), "&bogus; stays");
  assert.equal(decodeEntities("&#xZZ; stays"), "&#xZZ; stays");
});

test("gradeText: positive, negative, mixed, neutral — deterministic", () => {
  assert.equal(gradeText("this model is excellent and fast"), "positive");
  assert.equal(gradeText("constantly crashes, totally unusable"), "negative");
  assert.equal(gradeText("great quality but slow on my card"), "mixed");
  assert.equal(gradeText("released today with 128k context"), "neutral");
});

test("gradeText: a hedged positive is mixed, not positive", () => {
  assert.equal(gradeText("impressive results, however the setup hurt"), "mixed");
});

test("gradeText: no lexicon hit is neutral — never a guess", () => {
  assert.equal(gradeText("qwen3 32b Q4_K_M gguf benchmark numbers thread"), "neutral");
});

test("gradeText matches whole words only", () => {
  // "fastest" contains "fast" but is not the word "fast"; "slowly" is not "slow".
  assert.equal(gradeText("the fastest-changing field"), "neutral");
  assert.equal(gradeText("moving slowly through the backlog"), "neutral");
});

test("mentionsModel: whole-word family match, no substring false positives", () => {
  assert.ok(mentionsModel("just tried qwen3 on my 3090", "qwen3:32b"));
  assert.ok(mentionsModel("QWEN3 is out!", "qwen3:32b"), "case-insensitive");
  assert.ok(!mentionsModel("qwen30b is a typo here", "qwen3:32b"), "qwen3 must not match qwen30");
  assert.ok(mentionsModel("deepseek-r1 distill impressions", "deepseek-r1:32b"));
  assert.ok(!mentionsModel("unrelated post about llamas", "deepseek-r1:32b"));
});

test("mentionsModel: short families (<4 chars) require the full id", () => {
  // "phi" alone false-positives too easily (philosophy, Philadelphia).
  assert.ok(!mentionsModel("my philosophy on quantization", "phi:14b"));
  assert.ok(mentionsModel("running phi:14b locally", "phi:14b"));
});

test("redditToSignal parses a captured search.json row and grades it", () => {
  const child = {
    data: {
      title: "qwen3 32b is excellent on a single 3090",
      selftext: "Q4_K_M pulls 30 tok/s, very solid.",
      permalink: "/r/LocalLLaMA/comments/abc/qwen3_32b/",
      author: "localrunner",
      created_utc: 1_756_500_000,
    },
  };
  const s = redditToSignal(child, "qwen3:32b");
  assert.ok(s, "a matching post becomes a signal");
  assert.equal(s.source, "reddit");
  assert.equal(s.sourceUrl, "https://www.reddit.com/r/LocalLLaMA/comments/abc/qwen3_32b/");
  assert.equal(s.authorHandle, "u/localrunner");
  assert.equal(s.sentiment, "positive");
  assert.match(s.postedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("redditToSignal returns null for a post that never mentions the model", () => {
  const child = {
    data: {
      title: "weekly hardware thread",
      selftext: "post your rigs",
      permalink: "/r/LocalLLaMA/comments/xyz/weekly/",
      author: "mod",
      created_utc: 1_756_500_000,
    },
  };
  assert.equal(redditToSignal(child, "qwen3:32b"), null);
});

test("redditToSignal returns null on malformed rows instead of throwing", () => {
  assert.equal(redditToSignal({}, "qwen3:32b"), null);
  assert.equal(redditToSignal({ data: { title: "qwen3" } }, "qwen3:32b"), null);
});

test("hnToSignal parses an Algolia hit, strips HTML, grades it", () => {
  const hit = {
    objectID: "41234567",
    title: "",
    story_title: "Qwen3 released",
    comment_text: "tried <code>qwen3</code> locally — honestly impressive, beats my previous setup",
    author: "tester",
    created_at: "2026-08-28T10:00:00.000Z",
  };
  const s = hnToSignal(hit, "qwen3:32b");
  assert.ok(s);
  assert.equal(s.source, "hn");
  assert.equal(s.sourceUrl, "https://news.ycombinator.com/item?id=41234567");
  assert.equal(s.sentiment, "positive");
  assert.ok(!s.excerpt.includes("<code>"), "HTML is stripped from the excerpt");
});

test("hnToSignal excerpts carry no entity artifacts — the production bug", () => {
  const hit = {
    objectID: "9",
    title: "",
    story_title: "",
    comment_text:
      "qwen3 docs at https:&#x2F;&#x2F;docs.ollama.com&#x2F;context-length — I&#x27;ve tried it, &quot;solid&quot;",
    author: "petu",
    created_at: "2026-08-23T10:00:00.000Z",
  };
  const s = hnToSignal(hit, "qwen3:32b");
  assert.ok(s);
  assert.ok(!s.excerpt.includes("&#x2F;"), "hex entities decoded");
  assert.ok(!s.excerpt.includes("&quot;"), "named entities decoded");
  assert.ok(s.excerpt.includes("https://docs.ollama.com/context-length"), "URL reads clean");
});

test("hnToSignal returns null when the hit never mentions the model", () => {
  const hit = {
    objectID: "1",
    title: "Show HN: my new keyboard",
    comment_text: "",
    created_at: "2026-08-28T10:00:00.000Z",
  };
  assert.equal(hnToSignal(hit, "qwen3:32b"), null);
});
