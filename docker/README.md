# Whiskey Cellar — container build

A self-contained Docker image of the app. Same React front end and same API
(`../worker/index.ts`), but running on **Node + a local SQLite file** instead of
Cloudflare Workers + D1. Your Cloudflare deployment is untouched — nothing
outside this `docker/` folder changed.

## What's different from the Cloudflare version

| | Cloudflare | Container |
| --- | --- | --- |
| Runtime | Workers | Node 22 (`@hono/node-server`) |
| Database | D1 | SQLite file on a volume (`/data/whiskey.db`), via Node's built-in `node:sqlite` |
| Static files | Workers Assets | served by the Node process |
| Migrations | `wrangler d1 migrations apply` | run automatically on startup |
| Config | `wrangler.jsonc` vars + secrets | environment variables |
| Guest / taster site | `tasting.example.invalid` | single host — it's at `http://<host>:3000/guest` (browse, sign up, rate, keep tasting notes) |

The API code is shared verbatim; a small shim (`d1.ts`) gives `node:sqlite` the
D1 method names the Worker expects.

## Run it

```sh
cd docker
cp .env.example .env          # edit if you want email login / a fixed secret
docker compose up -d --build
```

Open <http://localhost:3000>. First visit → create the admin username + password.

Data (the SQLite file) persists in the `whiskey-cellar_data` Docker volume.
Rebuild/upgrade any time with `docker compose up -d --build` — migrations run
themselves and your data stays.

### Without compose

```sh
docker build -f docker/Dockerfile -t whiskey-cellar ..
docker run -d --name whiskey -p 3000:3000 \
  -v whiskey-data:/data \
  -e SESSION_SECRET="$(openssl rand -base64 32)" \
  whiskey-cellar
```

## Configuration (all optional — see `.env.example`)

| Variable | Purpose |
| --- | --- |
| `PORT` | host port (container is always 3000) |
| `SESSION_SECRET` | login-session signing key; auto-generated + stored in the DB if unset |
| `ADMIN_EMAIL` + `RESEND_API_KEY` | enable the "email me a 6-digit code" login |
| `ACCESS_TEAM` + `ACCESS_AUD` | trust a Cloudflare Access identity in front of the container |

## Behind a reverse proxy (TLS)

Terminate HTTPS at your proxy (Caddy, nginx, Traefik, Cloudflare Tunnel) and
forward to the container on port 3000. Pass `X-Forwarded-Proto: https` — the
server reads it so session cookies get the `Secure` flag. Example (Caddy):

```
whiskey.example.com {
    reverse_proxy localhost:3000
}
```

## Backups

Stop the application before taking a filesystem snapshot. Copy the complete
data directory, including any SQLite WAL/SHM sidecars, into a new empty backup
directory, then restart the application. A live copy of only whiskey.db is not
a consistent snapshot.

```sh
docker compose stop app
mkdir backup
docker run --rm -v whiskey-cellar_data:/data:ro -v "$PWD/backup":/backup alpine \
  cp -a /data/. /backup/
docker compose start app
```

## Notes

- `node:sqlite` is still flagged experimental in Node 22; the image silences the
  warning. Validate the pinned runtime for your deployment.
- The build needs BuildKit (Docker's default) for the scoped
  `Dockerfile.dockerignore`; it still builds without it.
