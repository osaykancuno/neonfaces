# neonfaces.xyz on Cloudflare

Why: the launch days are expected at thousands of visits a day and the site must not go down. Netlify's Free plan has 300 credits a month and **pauses every site** when they run out (no top-up without a paid plan); at about 12 credits per 1,000 visits the site would stop within days. On Cloudflare, **requests to static assets are free and unlimited on every plan**, deploys are atomic, and every earlier version comes back with one command. The site is static (the mint is on OpenSea, chain reads happen in each visitor's browser), so nothing else changes.

Since 2026 Cloudflare Pages is part of Cloudflare Workers: `wrangler pages project create` made a Worker. The site is therefore a **Worker with static assets only** (no Worker code ever runs, so every request is a free static one), named `neonfaces`, configured in `tools/cloudflare/preview.jsonc` (`landing/`) and `tools/cloudflare/web.jsonc` (`web/dist/`, single-page app). `tools/site.sh` publishes and checks: `tools/site.sh deploy preview|web`, `tools/site.sh check preview|web [BASE]`.

## What was checked (27 Sep 2026)

- The domain is registered at **Porkbun**, which also runs its DNS. Records: `A @ 75.2.60.5`, `A @ 99.83.231.61` (Netlify), `CNAME www reliable-kleicha-d69965.netlify.app`; **no MX, no TXT** (no email to keep); **DNSSEC is off**, so changing nameservers is safe. `www` answers 301 to `https://neonfaces.xyz/`.
- `wrangler dev` (4.142.0) served `landing/` byte for byte (53/53 files), right types (`.txt`, `.mp4`, `.json`), `landing/_headers` applied (camera allowed for NEONCAM, microphone blocked), an unknown path answering 404 as on Netlify, `_headers` not served. The wallet check worked on Cloudflare's simulator with a listed and an unlisted wallet, no console errors.
- `wrangler dev` served `web/dist/` with its app routes (`/face/12` and `/sets` get `index.html`), `deployment.json`, `llms.txt`, `neonfaces-mcp.mjs`, the security headers and the one-year cache on `assets/*` (17/17 files byte for byte). `web/dist/_redirects` (`/* /index.html 200`, for Netlify) is ignored with the warning "Infinite loop detected in this rule and has been ignored": expected, the config's single-page mode does that job.
- `/index.html` redirects to `/` (nothing links to it).
- **Phase 1 is done**: the preview is live at `https://neonfaces.osaykancuno.workers.dev` (53/53 files byte for byte, `server: cloudflare`, the headers, 404 on unknown paths).
- An apex domain on Cloudflare must be a **Cloudflare zone**: the nameservers move from Porkbun to Cloudflare; the registration stays at Porkbun.

## Phase 0: the account (the founder; done 27 Sep)

1. Free account at `https://dash.cloudflare.com/sign-up`, two-factor authentication on (My Profile > Authentication).

## Phase 1: the Worker and the first deploy (Claude; done 27 Sep)

2. `npx --yes wrangler@4.142.0 login` (the founder clicked Allow).
3. `SITE=https://neonfaces.osaykancuno.workers.dev tools/site.sh deploy preview`: publishes `landing/` and checks every file there.
4. The founder opens `https://neonfaces.osaykancuno.workers.dev` on a phone and a computer: home, NEONCAM, wallet check.

## Phase 2: the DNS moves to Cloudflare (the founder, 15 minutes plus waiting; no downtime)

The zone is created with the same records, so while the nameservers change the site keeps being served by Netlify.

5. Cloudflare dashboard > **Add a domain** (Onboard a domain) > `neonfaces.xyz` > quick scan of DNS records > **Free** plan.
6. Review the imported records. They must be exactly these three, each **DNS only** (grey cloud):
   | Type | Name | Content |
   |---|---|---|
   | A | `@` (neonfaces.xyz) | `75.2.60.5` |
   | A | `@` (neonfaces.xyz) | `99.83.231.61` |
   | CNAME | `www` | `reliable-kleicha-d69965.netlify.app` |
   Add any that is missing, delete anything else, then continue.
7. Cloudflare shows two nameservers (`<name>.ns.cloudflare.com`). At Porkbun: Domain Management > `neonfaces.xyz` > **Authoritative Nameservers** > Edit > delete the four `*.ns.porkbun.com`, paste the two Cloudflare ones > Submit. Leave DNSSEC off.
8. Wait for Cloudflare's email "neonfaces.xyz is now active" (usually under an hour, up to 24 h). Claude can confirm with `nslookup -type=NS neonfaces.xyz 8.8.8.8`.
9. Zone settings, once active: SSL/TLS > Edge Certificates > **Always Use HTTPS: On**; Scrape Shield > **Email Address Obfuscation: Off** (it rewrites HTML; the byte check must stay exact). Leave the rest at the defaults.

## Phase 3: the switch (the founder clicks, Claude checks; about 5 minutes, no downtime)

10. Workers & Pages > `neonfaces` > Settings > **Domains & Routes** > Add > **Custom domain** > `neonfaces.xyz` > Add. Cloudflare replaces the Netlify A records with its own and issues the certificate (minutes). Accept when it asks to replace the existing DNS records.
11. The same for `www.neonfaces.xyz` (it replaces the CNAME to Netlify).
12. Keep `www` redirecting to the apex as today: Rules > **Redirect Rules** > Create rule > template **"Redirect from WWW to root"** > Deploy (301, the path kept).
13. Claude adds the two custom domains to `tools/cloudflare/preview.jsonc` and `web.jsonc` (`"routes": [{ "pattern": "neonfaces.xyz", "custom_domain": true }, { "pattern": "www.neonfaces.xyz", "custom_domain": true }]`), so every later deploy states them, and checks: `tools/site.sh check preview` (53/53 on neonfaces.xyz), `server: cloudflare` and the headers, `https://www.neonfaces.xyz/face/1` answering 301 to `https://neonfaces.xyz/face/1`, the wallet check and NEONCAM in the browser.
14. Keep the Netlify site as it is until 15 October (the way back, below); then delete it.

The way back during phase 3: remove the two custom domains from the Worker; in DNS put back the three records of step 6 (DNS only). Netlify answers again within minutes.

## From now on: publishing

| When | Command | Way back |
|---|---|---|
| the preview changes (the list, the look) | `tools/site.sh deploy preview` | `npx --yes wrangler@4.142.0 rollback --name neonfaces` (the previous version, seconds), or Workers & Pages > neonfaces > Deployments |
| **Thu 8 Oct 14:00 UTC**, the web app replaces the preview | export the deployment with the Alchemy key (below), then `tools/site.sh deploy web` (it refuses a deployment.json that is not the mainnet one) | the same rollback returns the preview |

## The Alchemy key (first fallback for chain reads)

The site reads the chain from the official public node and falls back to Alchemy, PublicNode and dRPC (`web/src/chain.js`, `rpcFallbacks` in `tools/export-web.mjs`).

1. The Alchemy app is on **Robinhood Chain Mainnet**; its domain allowlist holds `neonfaces.xyz`, `www.neonfaces.xyz`, `neonfaces.pages.dev` (add `neonfaces.osaykancuno.workers.dev` only if the web app is ever tested there).
2. The URL (`https://robinhood-mainnet.g.alchemy.com/v2/<key>`) is kept in `contracts/.env` as `ALCHEMY_RPC_URL` (git-ignored). On 8 October:
   ```bash
   ALCHEMY_RPC_URL=$(grep '^ALCHEMY_RPC_URL=' contracts/.env | cut -d= -f2- | tr -d '\r" ') \
   OPENSEA_URL=https://opensea.io/collection/<slug> STRATEGY_AGENT=<runner address> node tools/export-web.mjs 4663
   ```
   It lands in the published `deployment.json` (git-ignored) and is never committed. Tested 27 Sep: chain 4663, full-range logs from block 0, 50-call batches, 30 parallel calls.
3. The allowlist works (checked 27 Sep): the three domains answer; other origins and requests with no Origin are refused, so the key works only from the site, not from scripts. If its free quota runs out, requests fall through to the keyless nodes.
