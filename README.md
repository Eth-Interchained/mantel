# 🔥 mantel — the hearthboard

> **NEDB stores knowledge. Portal renders experiences. mantel shows what your hearth can actually run.**

npmjs for local models, but social.

Every model directory tells you a name and a file size. None of them answer the two
questions you actually have:

1. **Will this run on my box?**
2. **Is it any good, according to real humans — and can I check?**

mantel answers both, with receipts.

## Three pillars

**1. VRAM-honest fit data.** Quant × context × VRAM, per model, plus
"fits on a 3090 / A6000 / 64GB Mac" badges. The fit math comes from hearth's admission
planner — the same code that decides what actually loads on a real GPU, not a
spec-sheet estimate.

**2. Provenance-chained public sentiment.** Real posts from real people — X, Bluesky,
r/LocalLLaMA, HN, HuggingFace discussions, GitHub issues. Every signal is stored with
`caused_by` pointing at the source document, so any claim on any page can be walked
back to the post it came from with a single `TRACE`. Reviews you can audit.

**3. One boring ranked feed.** "Best coder under 20GB." "Best reasoner that fits 48GB."
Transparent ranking, no social graph, no follows, no algorithm mystery.

## Identity is math, not a row in our database

There is no signup. You **derive** an identity:

```
nickname + salt  ──BLAKE2b──▶  identity hash  ──▶  mark#a3f9c2  + deterministic identicon
```

Re-enter the same nickname and salt anywhere and you are you again. We store only the
hash on your posts — no email, no password, no reset flow, no PII. Nothing to breach,
nothing to leak. Lose the salt and that identity is gone; that is the trade, stated up
front.

## The engine is embedded

mantel runs **NEDB in-process** via the `nedb-engine` native addon (v2 DAG store).
There is no `nedbd`, no port, no daemon to supervise:

- `verify()`, NQL and `TRACE` are direct native calls inside the request handler
- instant cold start — the v2 DAG store has no log to replay
- one process owns the data directory (the engine takes an exclusive lock and refuses
  split-brain opens), so **every write flows through this app** — including the
  ingestion crawler, which posts to an authenticated route rather than touching the
  files behind the app's back
- writes are flushed on `SIGTERM`/`SIGINT`/exit by the addon's own hook

Configuration is one variable:

```bash
NEDB_DATA_DIR=./mantel-data   # default
```

## Run it

```bash
npm install
npm run dev            # Portal dev server + API
npm run build && npm start
```

The health check reports the engine honestly — version, seq, Merkle head, and a live
tamper-evidence verdict:

```bash
curl -s localhost:3001/api/health
{"mantel":"ok","nedb":{"ok":true,"version":"2.8.2","engine":"embedded-v2-dag",
 "seq":41,"head":"f5240f85…","verified":true},"dataDir":"./mantel-data"}
```

## Tests

No mocks. The suites boot the real app against the real embedded engine in a scratch
data directory.

```bash
npm run typecheck
npm test          # unit + the embedded-engine adapter suite
npm run test:api  # live API suite
```

## Lineage

Forked from [nedb-links](https://github.com/Eth-Interchained/nedb-links), which supplied
the Portal + Express + NEDB skeleton, the identity-manifest patterns, and the deploy rig.
mantel replaces the daemon client with the embedded engine and repoints the product at
local models.

© INTERCHAINED LLC — GPLv3
