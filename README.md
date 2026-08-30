# ⬡ NEDB Links

> **NEDB stores knowledge. Portal renders experiences. Links publishes identity.**

One handle. One identity. Every surface.

NEDB Links is an **identity publishing platform** — claim a handle, build a structured
identity, and publish it everywhere: profile page, digital business card, QR code,
vCard, JSON API. It looks like a better link-in-bio. Underneath, it's a modern identity
platform backed by a database capable of provenance, time travel, and structured
history — and every feature exists to prove it.

```
User ──owns──▶ Identity ──renders──▶ Profile page
                                     Business card
                                     QR payload
                                     vCard
                                     JSON API
                                     …whatever you register next
```

## The model, not the page

The product is the **Identity Manifest** — a canonical, versioned document stored in
[NEDB](https://github.com/Eth-Interchained/nedb). The webpage is only renderer #1.

- **`identityId` is permanence.** Immutable, forever. History, provenance, backlinks,
  and printed QR codes hang off it.
- **Handles are branding.** Claim `marisayvettehair`, rename it later — the old handle
  301-redirects to the new one. Nothing ever breaks.
- **A user owns many identities.** Personal, business, brand, conference booth,
  anonymous demo. Identity ≠ user.
- **Blocks advertise capabilities** (`shareable`, `qr`, `printable`, `schedulable`, …)
  so renderers reason about content generically instead of guessing.

## Engine capability = product feature

The design principle of the whole Interchained ecosystem, demonstrated here in
production:

| NEDB primitive | Links feature |
| --- | --- |
| `AS OF seq` (MVCC time-travel) | Page history — view and restore any version of your identity |
| `VALID AS OF "date"` (bi-temporal) | Scheduled publishing — stage tomorrow's page today |
| `TRACE caused_by` (causal DAG) | Edit history — every change chained to its cause |
| `caused_by` / `evidence` provenance | Trust — writes carry their reason |
| Append-only hash-chained log | Restoration — nothing is ever truly lost |
| `verify()` (BLAKE2b Merkle) | Tamper-evident identities |
| Append-only events + NQL `GROUP BY` | Analytics — QR scans vs link taps in one query |

All state lives in a running [`nedbd`](https://github.com/Eth-Interchained/nedb) and is
accessed exclusively through
[`nedb-engine-client`](https://github.com/Eth-Interchained/nedb/tree/master/client/node).
There is no other database. There isn't even an ORM.

## The Extension Promise

> **If we can build it, you can build it.**

Every built-in block, template, renderer, importer, exporter, and theme uses the exact
same public APIs available to the community:

```ts
import { defineBlock, defineTemplate, defineRenderer } from "./src/lib/registry";

// A custom block — validated, capability-aware, editor-ready:
defineBlock({
  type: "bandcamp",
  name: "Bandcamp",
  description: "Latest release with embedded player.",
  capabilities: ["embeddable", "interactive"],
  schema: z.object({ url: z.string().url() }),
  defaults: () => ({ url: "https://" }),
});

// A custom surface — equal citizen with the profile page:
defineRenderer({
  id: "pdf",
  name: "Printable PDF",
  description: "The identity as a one-page printable.",
  consumes: ["printable", "exportable"],
  render: (manifest, ctx) => ({ contentType: "application/pdf", body: buildPdf(manifest) }),
});
```

This promise never changes. There is no private back door.

## Quickstart

```bash
# 1. A running NEDB daemon (all state lives here)
pip install nedb-engine
nedbd &

# 2. NEDB Links
npm install
cp .env.example .env    # set LINKS_ADMIN_TOKEN before going public
npm run dev             # Vite client :3000 + API :3001
```

Open `http://localhost:3000`, type a handle, claim, publish, share. That's the loop.
Manage everything after that at `/identities` — every identity you own — and `/edit/:id`,
the block editor with a live preview rendered by the exact renderer the public page uses.

**Production:**

```bash
npm run build   # portal build → dist/
npm run start   # serves editor + API + public profiles on PORT
```

One Node process + one nedbd. That's the entire deployment.

## Surfaces

Every published identity renders through the registry:

| URL | Renderer |
| --- | --- |
| `/:handle` | Profile page (server-rendered, mobile-first, zero client JS) |
| `/:handle?format=card` | Digital business card — screen-shareable, print-true at 3.5in × 2in |
| `/:handle?format=qr` | Print-grade QR (SVG; `&type=png&size=…` for PNG, `&download=1` to save) |
| `/:handle?format=vcard` | Importable contact (vCard 3.0, stable UID — re-downloads update, never duplicate) |
| `/:handle?format=json` | The Identity Manifest as structured JSON |
| `/go/:identityId/:blockId?to=…` | Click-tracked outbound redirect |

Publishing yields the full share kit at once: share URL, downloadable QR (SVG + PNG),
save-contact vCard, business card, and social preview tags. Every QR encodes `?src=qr`,
so scans land as events distinct from taps — `FROM events WHERE kind = "profile_view"
GROUP BY source COUNT` answers "salon counter vs Instagram bio" straight from the engine.

More surfaces land through the same registry — track the
[issues](../../issues) for the living backlog. No roadmap documents; shipped code and
open issues only.

## Testing

```bash
npm test        # renderer suites — pure, no engine needed
npm run test:api  # the REAL app against a REAL nedbd — boot nedbd first
```

CI boots an actual NEDB engine (`pip install nedb-engine`) and runs the live suite
against it on every PR. No mocks — the engine is under test as much as the app.

## Architecture

```
routes/               Portal pages (the editor SPA — React)
src/lib/identity.ts   The Identity Manifest — the canonical contract
src/lib/registry.ts   defineBlock / defineTemplate / defineRenderer
src/lib/blocks/       Built-in blocks (via the public API)
src/lib/templates/    Built-in who-are-you templates (via the public API)
src/lib/renderers/    Built-in renderers (via the public API)
src/server/           Express: API routes, auth, public rendering
server.ts             Bootstrap: API + public surfaces + editor SPA
app.contract.ts       Portal contract (audience, goals, brand, SEO)
```

Viewers get small server-rendered HTML. The React app is for editing, never viewing.

## License

[GPL-3.0-or-later](LICENSE) — like
[NEDB Studio](https://github.com/Eth-Interchained/nedb-studio).

---

**© INTERCHAINED LLC × Claude Sonnet 4.6** — part of the
[NEDB](https://github.com/Eth-Interchained/nedb) ecosystem.
