#!/bin/sh
# Writes .env.production.local from the repo's GitHub Actions variables, so local
# app builds (iOS) use the same public config as the website. Needs `gh auth login`.
# These are public-by-design values (URL, publishable key, Turnstile site key).
set -e
repo="${GITHUB_REPO:-AlessioCarta/innerclock}"
out=".env.production.local"
: > "$out"
for v in VITE_SUPABASE_URL VITE_SUPABASE_ANON_KEY VITE_TURNSTILE_SITE_KEY; do
  echo "$v=$(gh variable get "$v" -R "$repo")" >> "$out"
done
echo "Wrote $out from $repo variables"
