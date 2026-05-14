// Shared money-clip cache for the full publications list, with a Typesense
// count check that triggers a refetch when the local cache disagrees with
// the index. Both /paper/<slug> (paperDetail) and /publications (sorghum
// publications bundle) use this loader so they share one cache entry.

import { getConfiguredCache } from 'money-clip'
import { expectedCount } from './typesense_counts'

const ONE_DAY = 1000 * 60 * 60 * 24

const publicationsRawCache = getConfiguredCache({
  maxAge: ONE_DAY,
  version: 1,
  name: 'publicationsRaw',
})

const PUBLICATIONS_URL = '/api/wp_cache/publications'
const TYPESENSE_COLLECTION = 'papers'

function fetchAndCache() {
  return fetch(PUBLICATIONS_URL, { headers: { Accept: 'application/json' } })
    .then((r) => {
      if (!r.ok) throw new Error(`publications ${r.status}`)
      return r.json()
    })
    .then((rows) => {
      if (rows && rows.length) publicationsRawCache.set('all', rows)
      return rows
    })
}

export function loadPublications() {
  return publicationsRawCache.get('all').then((cached) => {
    if (!cached || !cached.length) return fetchAndCache()
    return expectedCount(TYPESENSE_COLLECTION).then((expected) => {
      if (expected !== null && expected !== cached.length) {
        return fetchAndCache()
      }
      return cached
    })
  })
}
