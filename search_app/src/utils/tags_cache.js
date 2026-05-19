// Shared money-clip cache for WP tags. Timestamp-based freshness
// against /api/wp_cache/_timestamps (see publications_cache.js for the
// pattern).

import { getConfiguredCache } from 'money-clip'
import { expectedTimestamp, timestampFromResponse } from './wp_cache_timestamps'

const ONE_DAY = 1000 * 60 * 60 * 24

const tagsRawCache = getConfiguredCache({
  maxAge: ONE_DAY,
  version: 2,
  name: 'tagsRaw',
})

const TAGS_URL = '/api/wp_cache/tags'
const RESOURCE = 'tags'

function fetchAndCache() {
  return fetch(TAGS_URL, { headers: { Accept: 'application/json' } })
    .then((r) => {
      if (!r.ok) throw new Error(`tags ${r.status}`)
      const ts = timestampFromResponse(r)
      return r.json().then((rows) => {
        if (rows && rows.length) {
          tagsRawCache.set('all', { data: rows, fetched_at: ts })
        }
        return rows
      })
    })
}

export function loadTags() {
  return tagsRawCache.get('all').then((cached) => {
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
