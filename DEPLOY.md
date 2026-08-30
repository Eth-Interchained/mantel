# Deploying NEDB Links

One repo, one build, any number of storefronts. Production is a single
Node process per deployment — Express serves the API, the editor SPA,
and every public profile surface. **Never run `pnpm run dev` in
production**: that's two processes, an exposed Vite dev server, and the
dev proxy in your request path.

## The short version

```bash
git pull
pnpm install            # build needs devDependencies (portal, tailwind, vite)
pnpm run build          # → dist/ — one build works for every deployment
pnpm start              # NODE_ENV=production, one process, done
```

The process listens on `LINKS_API_PORT` (default 3001) and needs a
running `nedbd` (`NEDB_URL`, default `http://127.0.0.1:7070`).

## Two storefronts from one repo

Each deployment is a **checkout + `.env` + process**. The code is
identical; the env is the product.

```
~/apps/links-interchained/     ~/apps/links-nedb/
  .env → wallet product          .env → email product
  pnpm start (:3001)             pnpm start (:3002)
```

**interchained.org** (`~/apps/links-interchained/.env`):

```env
LINKS_AUTH_MODE=wallet
LINKS_DEFAULT_THEME=mach
LINKS_API_PORT=3001
PUBLIC_ORIGIN=https://interchained.org
NEDB_URL=http://127.0.0.1:7070
NEDB_DB=links_interchained
# Stripe (live keys + this domain's webhook secret), IMGBB_API_KEY, …
```

**ne-db.com** (`~/apps/links-nedb/.env`):

```env
LINKS_AUTH_MODE=email
LINKS_BRAND_NAME=ne-db
LINKS_DEFAULT_THEME=v3
LINKS_API_PORT=3002
PUBLIC_ORIGIN=https://ne-db.com
NEDB_URL=http://127.0.0.1:7070
NEDB_DB=links_nedb
SMTP_HOST=box.ne-db.com
SMTP_PORT=587
SMTP_SECURE=0
SMTP_USER=no-reply@ne-db.com
SMTP_PASS=…
MAIL_FROM="ne-db <no-reply@ne-db.com>"
# Stripe (live keys + this domain's webhook secret), IMGBB_API_KEY, …
```

Separate `NEDB_DB` names keep the two products' data cleanly apart on
one engine. Email mode **refuses to boot** without SMTP + PUBLIC_ORIGIN
— that's on purpose; a dead mail path is a dead account system.

## Keeping it running

tmux works (one window per process) and matches a home-directory-only
setup. If you want crash-restart and reboot persistence without
touching systemd:

```bash
npm i -g pm2
cd ~/apps/links-interchained && pm2 start "pnpm start" --name links-itc
cd ~/apps/links-nedb        && pm2 start "pnpm start" --name links-nedb
pm2 save && pm2 startup     # prints the one-liner for boot persistence
```

`pm2 logs links-nedb` tails a deployment; `pm2 restart links-nedb`
after a `git pull && pnpm run build`.

## Getting traffic to it (Cloudflare)

The clean setup is **cloudflared Tunnel** — no open ports on the
origin, encrypted box-to-edge (retires the Flexible-SSL weakness), one
binary that's perfectly happy in tmux or pm2:

```yaml
# ~/.cloudflared/config.yml
tunnel: <tunnel-id>
credentials-file: /home/you/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: interchained.org
    service: http://localhost:3001
  - hostname: ne-db.com
    service: http://localhost:3002
  - service: http_status:404
```

`cloudflared tunnel run` and both storefronts are live behind
Cloudflare with zero origin exposure. (Alternative: nginx/caddy on
80/443 proxying to the two ports + Cloudflare Full (Strict) — more
moving parts, same result.)

## Update procedure

```bash
cd ~/apps/links-nedb
git pull
pnpm install
pnpm run build
pm2 restart links-nedb      # or restart the tmux process
```

Sessions, accounts, profiles, analytics all live in the engine —
restarts are stateless and safe.

## Pre-launch checklist

- [ ] `nedbd` data directory on a disk you back up (the engine IS the database)
- [ ] Stripe **live** keys + a live-mode webhook endpoint per domain (test/live secrets differ!)
- [ ] `PUBLIC_ORIGIN` set on every deployment (checkout redirects, QR payloads, email links)
- [ ] Email mode: send yourself a signup — verify the MIAB path end to end
- [ ] `IMGBB_API_KEY` if you want uploads (absent = URL-only, still works)
- [ ] Known queue, pre-public-traffic: rate limiting on auth endpoints (uploads already throttle)
