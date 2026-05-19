// Shared cache for conference abstracts. Both /abstracts (list) and
// /abstract/<slug> (detail) use this loader. Timestamp-based freshness
// check against /api/wp_cache/_timestamps (see publications_cache.js
// for the pattern).

import { getConfiguredCache } from 'money-clip'
import { expectedTimestamp, timestampFromResponse } from './wp_cache_timestamps'

const ONE_DAY = 1000 * 60 * 60 * 24

const abstractsCache = getConfiguredCache({
  maxAge: ONE_DAY,
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

export function loadAbstracts() {
  return abstractsCache.get('all').then((cached) => {
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
