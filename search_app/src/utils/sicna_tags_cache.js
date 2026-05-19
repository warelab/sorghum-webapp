// SICNA tag lookups for deriving conference name + year on the
// abstracts table. Timestamp-based freshness against
// /api/wp_cache/_timestamps for the sicna_tags resource.

import { getConfiguredCache } from 'money-clip'
import { expectedTimestamp, timestampFromResponse } from './wp_cache_timestamps'

const ONE_DAY = 1000 * 60 * 60 * 24

const sicnaTagsCache = getConfiguredCache({
  maxAge: ONE_DAY,
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

export function loadSicnaTags() {
  return sicnaTagsCache.get('all').then((cached) => {
    const local = _unwrap(cached)
    if (!local) return fetchAndCache()
    return expectedTimestamp(RESOURCE).then((serverTs) => {
      if (serverTs !== null && serverTs > local.fetched_at) {
        return fetchAndCache()
      }
      return local.data
    })
  })
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
