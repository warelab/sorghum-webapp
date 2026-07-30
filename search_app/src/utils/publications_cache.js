// Shared money-clip cache for the full publications list, with a
// timestamp-based freshness check against the server's view of the
// cache. Both /paper/<slug> (paperDetail) and /publications (sorghum
// publications bundle) use this loader so they share one cache entry.
//
// Money-clip stores `{data, fetched_at}` -- fetched_at is the server's
// X-Wp-Cache-Fetched-At at the time the data was retrieved. On
// subsequent reads we ask /api/wp_cache/_timestamps for the current
// server value; if it's newer than what we stored, the local copy is
// out of date and we refetch. That check now runs in the background
// (see wp_cache_swr) so a warm cache resolves without waiting on it.

import { getConfiguredCache } from 'money-clip'
import { timestampFromResponse } from './wp_cache_timestamps'
import { staleWhileRevalidate } from './wp_cache_swr'

// Version bumped from 1 -> 2 because the cache shape changed
// (bare array -> envelope). Old entries are dropped on first read.
const publicationsRawCache = getConfiguredCache({
  maxAge: Infinity,
  version: 2,
  name: 'publicationsRaw',
})

const PUBLICATIONS_URL = '/api/wp_cache/publications'
const RESOURCE = 'publications'

function fetchAndCache() {
  return fetch(PUBLICATIONS_URL, { headers: { Accept: 'application/json' } })
    .then((r) => {
      if (!r.ok) throw new Error(`publications ${r.status}`)
      const ts = timestampFromResponse(r)
      return r.json().then((rows) => {
        if (rows && rows.length) {
          publicationsRawCache.set('all', { data: rows, fetched_at: ts })
        }
        return rows
      })
    })
}

// `onFresh` is called if revalidation finds a newer copy on the server, so a
// cached list can render immediately and update in place a moment later.
export function loadPublications(onFresh) {
  return publicationsRawCache.get('all').then((cached) =>
    staleWhileRevalidate({
      cached: _unwrap(cached),
      resource: RESOURCE,
      refetch: fetchAndCache,
      onFresh,
    }),
  )
}

// money-clip may hand back either the new envelope or a stray pre-v2
// bare array if the version bump hasn't kicked in yet. Normalise.
function _unwrap(cached) {
  if (!cached) return null
  if (Array.isArray(cached)) {
    return cached.length ? { data: cached, fetched_at: 0 } : null
  }
  if (cached.data && Array.isArray(cached.data) && cached.data.length) {
    return { data: cached.data, fetched_at: cached.fetched_at || 0 }
  }
  return null
}
