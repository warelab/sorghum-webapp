// Shared money-clip cache for WP tags. The publications bundle wraps the
// raw rows into a {tagId: name} lookup for the UI; other consumers can use
// the raw array directly.

import { getConfiguredCache } from 'money-clip'
import { expectedCount } from './typesense_counts'

const ONE_DAY = 1000 * 60 * 60 * 24

const tagsRawCache = getConfiguredCache({
  maxAge: ONE_DAY,
  version: 1,
  name: 'tagsRaw',
})

const TAGS_URL = '/api/wp_cache/tags'
const TYPESENSE_COLLECTION = 'tags'

function fetchAndCache() {
  return fetch(TAGS_URL, { headers: { Accept: 'application/json' } })
    .then((r) => {
      if (!r.ok) throw new Error(`tags ${r.status}`)
      return r.json()
    })
    .then((rows) => {
      if (rows && rows.length) tagsRawCache.set('all', rows)
      return rows
    })
}

export function loadTags() {
  return tagsRawCache.get('all').then((cached) => {
    if (!cached || !cached.length) return fetchAndCache()
    return expectedCount(TYPESENSE_COLLECTION).then((expected) => {
      if (expected !== null && expected !== cached.length) {
        return fetchAndCache()
      }
      return cached
    })
  })
}
