// Shared cache for conference abstracts. Both /abstracts (list) and
// /abstract/<slug> (detail) use this loader. Timestamp-based freshness
// check against /api/wp_cache/_timestamps (see publications_cache.js
// for the pattern).

import { getConfiguredCache } from 'money-clip'
import { timestampFromResponse } from './wp_cache_timestamps'
import { staleWhileRevalidate } from './wp_cache_swr'

const abstractsCache = getConfiguredCache({
  maxAge: Infinity,
  version: 2,
  name: 'abstractsRaw',
})

const ABSTRACTS_URL = '/api/wp_cache/conference_abstracts'
const RESOURCE = 'conference_abstracts'

function fetchAndCache() {
  return fetch(ABSTRACTS_URL, { headers: { Accept: 'application/json' } })
    .then((r) => {
      if (!r.ok) throw new Error(`abstracts ${r.status}`)
      const ts = timestampFromResponse(r)
      return r.json().then((rows) => {
        if (rows && rows.length) {
          abstractsCache.set('all', { data: rows, fetched_at: ts })
        }
        return rows
      })
    })
}

// `onFresh` is called if revalidation finds a newer copy on the server, so a
// cached list can render immediately and update in place a moment later.
export function loadAbstracts(onFresh) {
  return abstractsCache.get('all').then((cached) =>
    staleWhileRevalidate({
      cached: _unwrap(cached),
      resource: RESOURCE,
      refetch: fetchAndCache,
      onFresh,
    }),
  )
}

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
