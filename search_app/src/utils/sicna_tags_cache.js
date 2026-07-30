// SICNA tag lookups for deriving conference name + year on the
// abstracts table. Timestamp-based freshness against
// /api/wp_cache/_timestamps for the sicna_tags resource.

import { getConfiguredCache } from 'money-clip'
import { timestampFromResponse } from './wp_cache_timestamps'
import { staleWhileRevalidate } from './wp_cache_swr'

const sicnaTagsCache = getConfiguredCache({
  maxAge: Infinity,
  version: 2,
  name: 'sicnaTagsRaw',
})

const SICNA_TAGS_URL = '/api/wp_cache/sicna_tags'
const RESOURCE = 'sicna_tags'

function fetchAndCache() {
  return fetch(SICNA_TAGS_URL, { headers: { Accept: 'application/json' } })
    .then((r) => {
      if (!r.ok) throw new Error(`sicna_tags ${r.status}`)
      const ts = timestampFromResponse(r)
      return r.json().then((rows) => {
        if (rows && rows.length) {
          sicnaTagsCache.set('all', { data: rows, fetched_at: ts })
        }
        return rows
      })
    })
}

// `onFresh` is called if revalidation finds a newer copy on the server, so a
// cached list can render immediately and update in place a moment later.
export function loadSicnaTags(onFresh) {
  return sicnaTagsCache.get('all').then((cached) =>
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
