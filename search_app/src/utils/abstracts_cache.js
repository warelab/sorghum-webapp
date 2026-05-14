// Shared cache for conference abstracts. Both /abstracts (list) and
// /abstract/<slug> (detail) use this loader so the data only crosses the
// wire once per cache window. Count check against the Typesense `abstracts`
// collection drops stale local data automatically.

import { getConfiguredCache } from 'money-clip'
import { expectedCount } from './typesense_counts'

const ONE_DAY = 1000 * 60 * 60 * 24

const abstractsCache = getConfiguredCache({
  maxAge: ONE_DAY,
  version: 1,
  name: 'abstractsRaw',
})

const ABSTRACTS_URL = '/api/wp_cache/conference_abstracts'
const TYPESENSE_COLLECTION = 'abstracts'

function fetchAndCache() {
  return fetch(ABSTRACTS_URL, { headers: { Accept: 'application/json' } })
    .then((r) => {
      if (!r.ok) throw new Error(`abstracts ${r.status}`)
      return r.json()
    })
    .then((rows) => {
      if (rows && rows.length) abstractsCache.set('all', rows)
      return rows
    })
}

export function loadAbstracts() {
  return abstractsCache.get('all').then((cached) => {
    if (!cached || !cached.length) return fetchAndCache()
    return expectedCount(TYPESENSE_COLLECTION).then((expected) => {
      if (expected !== null && expected !== cached.length) {
        return fetchAndCache()
      }
      return cached
    })
  })
}
