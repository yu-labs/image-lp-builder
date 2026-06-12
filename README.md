# image-lp-builder

The fastest way for non-engineers to publish an image-based landing
page on their own Cloudflare account — drop image sections, place
clickable CTAs over them, hit publish.

## Deploy

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/yu-labs/image-lp-builder)

One click. The button creates a standalone copy of this repo in your
GitHub account, then asks Cloudflare to:

- Provision a Worker, a D1 database, an R2 bucket, the required KV
  namespace, and the bindings declared in `wrangler.jsonc`.
- Run the `deploy` script from `package.json`, which builds the
  app and deploys the Worker.
- Let the app apply any pending D1 migrations automatically on the
  first request, so a fresh install does not need a manual SQL or
  `wrangler d1 migrations apply` step.

After the build finishes you get a `*.workers.dev` URL — open
`/admin`, sign in with Google, and start building. On a fresh install,
the first Google account to sign in becomes the owner. No SQL prompt
to run, no `wrangler` commands to type, no Cloudflare dashboard
settings to flip. To upgrade later, open `/admin/update`; the app
syncs the canonical upstream release into your GitHub repo, then lets
Cloudflare build the new commit.

## Stack

- Astro 6 + React 19 islands + Tailwind v4
- Cloudflare Workers (compute), D1 (database and admin sessions), R2
  (uploaded image storage), Cloudflare Images binding (image
  processing), KV (Astro session storage, temporary locks, and rate
  limiting)
- Google OAuth for admin authentication

## Local Development

Requires Node.js 22.12 or later. Use [Corepack](https://nodejs.org/api/corepack.html) to activate the pnpm version declared in `package.json`:

```bash
corepack enable
pnpm install
pnpm run dev
```

The dev command prints both the local admin URL and the LAN admin URL
for phone testing. Local image uploads use an in-memory fallback when
R2 is not available; production uploads still use R2.

Build:

```bash
pnpm run build
```

## Configuration

The public release uses `yu-labs/image-lp-builder` as its canonical
upstream repository. The self-update screen checks releases from that
repo and syncs from it when the admin installs the matching GitHub App.

`wrangler.jsonc` includes a default `OAUTH_RELAY_URL` pointing to the
hosted OAuth relay for Google login and GitHub App installation. This
is public configuration, not a secret. If you operate your own
compatible relay, override `OAUTH_RELAY_URL` in your Cloudflare Worker
settings. See `.env.example` for the local development shape.

Hub Connector settings are configured from the admin UI. Leaving the
Connector disabled keeps the builder working as a standalone image LP
publishing tool.

## Security considerations

### Open the admin promptly after deploy

The first Google account to sign in at `/admin` becomes the owner
of this Worker — that's how the Deploy button avoids asking you
for an email up front. Open `/admin` as soon as the build
finishes so you claim the owner slot before anyone else can. If
someone else races in, you can clear the `admin_users` table from
the Cloudflare D1 console and try again.

### Tracking scripts share the admin origin

The site-settings panel lets the admin paste arbitrary HTML into
the public LP `<head>` — typically GTM / GA4 / Meta Pixel / Clarity
snippets. Those scripts run on the same origin as the admin API,
so any script you paste effectively has the admin's session
authority while the admin is logged in.

- Only paste tracking snippets you control (your own GTM / Pixel
  containers — not third-party scripts you don't trust).
- Treat your GTM / Pixel accounts as part of the admin attack
  surface; harden them with 2FA / least-privilege.

## License

[GNU Affero General Public License v3.0](LICENSE) (AGPLv3).
