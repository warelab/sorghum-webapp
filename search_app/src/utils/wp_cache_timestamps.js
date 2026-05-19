// Fetches the {resource: fetched_at} map from /api/wp_cache/_timestamps
// and lets cache loaders ask "is my locally-stored copy older than the
// server's latest version?"
//
// The cron warm (or any /meta?force=1 call, or any in-process _patch_wp_cache)
// updates fetched_at on the server side. Clients store their fetched_at
// alongside the data in money-clip; on subsequent visits a newer server
// timestamp triggers a refetch -- catching not just additions/removals
// (which the old num_documents check also caught) but in-place edits
// too.
//
// One shared in-flight promise across callers + a 30s in-memory cache
// so multiple components mounting on the same page don't each hit
// /api/wp_cache/_timestamps.

let inflight = null;
let lastValue = null;
let lastFetched = 0;

const TTL_MS = 30 * 1000;

export function getWpCacheTimestamps() {
  const now = Date.now();
  if (lastValue && now - lastFetched < TTL_MS) {
    return Promise.resolve(lastValue);
  }
  if (inflight) return inflight;
  inflight = fetch('/api/wp_cache/_timestamps', { headers: { Accept: 'application/json' } })
    .then((r) => {
      if (!r.ok) throw new Error(`timestamps ${r.status}`);
      return r.json();
    })
    .then((timestamps) => {
      lastValue = timestamps || {};
      lastFetched = Date.now();
      inflight = null;
      return lastValue;
    })
    .catch((e) => {
      inflight = null;
      throw e;
    });
  return inflight;
}

// Returns the server's fetched_at for `resource`, or null if it can't
// be determined. Callers should treat null as "no signal -- keep using
// what you have."
export function expectedTimestamp(resource) {
  return getWpCacheTimestamps()
    .then((tsMap) => {
      const v = tsMap && tsMap[resource];
      return typeof v === 'number' ? v : null;
    })
    .catch(() => null);
}

// Pulls the per-resource timestamp from the response of a wp_cache GET
// (the server stamps it as X-Wp-Cache-Fetched-At). Useful inside
// fetchAndCache helpers so we record the *exact* version the data
// reflects, not whatever /api/wp_cache/_timestamps happens to return
// a few hundred ms later.
export function timestampFromResponse(response) {
  const raw = response && response.headers && response.headers.get('X-Wp-Cache-Fetched-At');
  const n = parseFloat(raw || '0');
  return Number.isFinite(n) ? n : 0;
}
