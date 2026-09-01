#!/bin/sh
# Refill the server-side WP cache (controllers/wp_cache.py) so visitors
# never pay the cold-fetch cost. Schedule from cron at an interval shorter
# than WP_CACHE_TTL (default 3600s).
#
# Usage:
#   warm_wp_cache.sh [base_url]
#   BASE_URL env var also works. Default: http://127.0.0.1:5000
#
# Resources are pulled from /api/wp_cache/_resources, so adding a new
# resource to controllers/wp_cache.py automatically gets it warmed too.
#
# Output convention: a healthy run is SILENT on stdout and stderr, and
# per-resource progress goes to syslog (tag wp_cache_warm) from in here.
# Only failures print, so cron's MAILTO delivers a mail exactly when
# something is wrong -- do not pipe this into logger from the crontab, or
# the pipeline's exit status becomes logger's and cron can never alert.
#
# Two distinct failure modes are reported, both exit 1:
#   FAILED <resource>  the refill request itself errored (non-2xx / timeout)
#   STALE  <resource>  the request succeeded but wp_cache refused the fresh
#                      payload (empty or far smaller than what's cached) and
#                      is still serving the previous good data. See
#                      _reject_reason in controllers/wp_cache.py.
#
# Example crontab (every 30 min):
#   MAILTO=you@example.org
#   */30 * * * * /path/to/warm_wp_cache.sh https://www.sorghumbase.org

set -eu

BASE="${1:-${BASE_URL:-http://127.0.0.1:5000}}"
TAG=wp_cache_warm

note() { logger -t "$TAG" "$1" 2>/dev/null || true; }

# Report to stderr (so cron mails it) and to syslog (so it's in the journal).
fail() { echo "$1" >&2; logger -t "$TAG" -p user.err "$1" 2>/dev/null || true; }

body=$(mktemp) || exit 1
trap 'rm -f "$body"' EXIT INT TERM

# Pull the resource list as a JSON array, strip brackets/quotes/commas,
# leaving one resource name per line. No jq dependency.
resources=$(curl -sSf --max-time 10 "$BASE/api/wp_cache/_resources" \
    | tr -d '[]" ' | tr ',' '\n') || {
    fail "FAILED to list resources from $BASE/api/wp_cache/_resources"
    exit 1
}

if [ -z "$resources" ]; then
    fail "no resources returned from $BASE/api/wp_cache/_resources"
    exit 1
fi

rc=0
for resource in $resources; do
    url="$BASE/api/wp_cache/$resource/meta?force=1"

    # -f is deliberately omitted: we need the body on a soft failure, and the
    # status code is checked explicitly below.
    code=$(curl -sS --max-time 120 -o "$body" -w '%{http_code}' "$url" || echo 000)

    if [ "$code" != "200" ]; then
        fail "FAILED $resource (HTTP $code from $url)"
        rc=1
        continue
    fi

    # A non-null "last_refill_error" means the guard kept the old payload.
    if grep -q '"last_refill_error"[[:space:]]*:[[:space:]]*"' "$body"; then
        reason=$(sed -n 's/.*"last_refill_error"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$body")
        fail "STALE $resource: ${reason:-refill rejected} ($url)"
        rc=1
        continue
    fi

    note "warmed $resource"
done
exit $rc
