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
# Example crontab (every 30 min, log to syslog):
#   */30 * * * * /path/to/warm_wp_cache.sh https://www.sorghumbase.org 2>&1 | logger -t wp_cache_warm

set -eu

BASE="${1:-${BASE_URL:-http://127.0.0.1:5000}}"

# Pull the resource list as a JSON array, strip brackets/quotes/commas,
# leaving one resource name per line. No jq dependency.
resources=$(curl -sSf --max-time 10 "$BASE/api/wp_cache/_resources" \
    | tr -d '[]" ' | tr ',' '\n')

if [ -z "$resources" ]; then
    echo "no resources returned from $BASE/api/wp_cache/_resources" >&2
    exit 1
fi

rc=0
for resource in $resources; do
    url="$BASE/api/wp_cache/$resource/meta?force=1"
    if curl -sSf --max-time 120 "$url" >/dev/null; then
        echo "warmed $resource"
    else
        echo "FAILED $resource ($url)" >&2
        rc=1
    fi
done
exit $rc
