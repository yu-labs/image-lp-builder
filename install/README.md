# Install Notes

The recommended installation path is the Deploy to Cloudflare button in
the root `README.md`.

Cloudflare will create the Worker and the required D1, R2, and KV
resources from `wrangler.jsonc`. The project uses one KV namespace for
Astro session storage, temporary locks, and rate limits; admin login
sessions are stored in D1, not KV. The project also declares the runtime
bindings it needs, including Cloudflare Images. The deploy script builds
the app, deploys the Worker, and the app applies D1 migrations
automatically on the first request.

Hub Connector is optional. Leave it disabled if you only need the
standalone image LP builder.

## Local Development

Use Node.js 22.12 or later and pnpm via Corepack:

```bash
corepack enable
pnpm install
pnpm run dev
```

The dev command prints both desktop and LAN admin URLs. Local image
uploads can use an in-memory fallback when R2 is not available; deployed
Workers use R2.

## Configuration

The default OAuth relay URL in `wrangler.jsonc` is public configuration,
not a secret. Override `OAUTH_RELAY_URL` in Cloudflare Worker settings
only if you operate a compatible relay yourself.

Optional Hub Connector and managed provider settings are documented in
`.env.example`. Leave them unset for a normal self-hosted installation.
