#!/usr/bin/env bash
# neonfaces.xyz on Cloudflare (Worker "neonfaces", static assets only): publish a folder, then check the live site byte
# for byte. Configs: tools/cloudflare/preview.jsonc (landing/) and web.jsonc (web/dist/, single-page app).
#
#   tools/site.sh check preview [BASE]    compare landing/ with the live site (default BASE https://neonfaces.xyz)
#   tools/site.sh check web [BASE]        compare web/dist/ with the live site
#   tools/site.sh deploy preview          publish landing/ (the preview, until the public stage opens)
#   tools/site.sh deploy web              build web/ and publish web/dist/ (the web app, from the public stage)
#   SITE=https://neonfaces.osaykancuno.workers.dev tools/site.sh deploy preview   check another address after publishing
#
# Requests to static assets are free and unlimited on every Cloudflare plan (Netlify's Free plan pauses the site when
# its monthly credits run out). A deploy is atomic and every earlier version stays one command away:
# `npx wrangler@4.142.0 rollback --name neonfaces` (or the dashboard: Workers & Pages > neonfaces > Deployments).
# Needs `npx wrangler@4.142.0 login` once (the account's owner approves it in the browser). Details: docs/SITE-HOSTING.md.
set -euo pipefail
cd "$(dirname "$0")/.."
WRANGLER="npx --yes wrangler@4.142.0"
what=${2:-}
case "$what" in
  preview) DIR=landing ;;
  web) DIR=web/dist ;;
  *) sed -n '2,14p' "$0"; exit 1 ;;
esac

check() {
  local base=${1:-${SITE:-https://neonfaces.xyz}} n=0 bad=0 p u tmp
  # _headers and _redirects are read by Pages, not served; index.html is served at "/" (Pages drops the name)
  while IFS= read -r f; do
    p=${f#"$DIR"/}
    case "$p" in _headers | _redirects) continue ;; esac
    [[ "$p" == index.html ]] && u="/" || u="/$p"
    tmp=$(mktemp)
    for attempt in 1 2 3; do # a fresh deploy can take a few seconds to reach every edge
      curl -s -L -o "$tmp" "$base$u?v=$RANDOM" && cmp -s "$tmp" "$f" && break
      [[ $attempt == 3 ]] && { echo "DIFF $u"; bad=$((bad + 1)); } || sleep 5
    done
    rm -f "$tmp"
    n=$((n + 1))
  done < <(find "$DIR" -type f | sort)
  echo "$base: $n files checked, $bad different"
  [[ $bad == 0 ]]
}

case "${1:-}" in
  check) check "${3:-}" ;;
  deploy)
    if [[ "$what" == web ]]; then
      [[ -f web/public/deployment.json ]] || { echo "web/public/deployment.json missing: run tools/export-web.mjs 4663 first"; exit 1; }
      node -e 'process.exit(require("./web/public/deployment.json").chain?.id === 4663 ? 0 : 1)' ||
        { echo "web/public/deployment.json is not the mainnet deployment (4663)"; exit 1; }
      npm --prefix web run build
    fi
    $WRANGLER deploy -c "tools/cloudflare/$what.jsonc"
    echo "published; checking the live site in 20 s"
    sleep 20
    check
    ;;
  *) sed -n '2,14p' "$0"; exit 1 ;;
esac
