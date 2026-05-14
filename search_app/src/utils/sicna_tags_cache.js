// SICNA tag lookups for derivation of conference name + year on the
// abstracts table. No Typesense count check — the sicna subset isn't a
// standalone collection — so this just uses a TTL.

import { getConfiguredCache } from 'money-clip'

const ONE_DAY = 1000 * 60 * 60 * 24

const sicnaTagsCache = getConfiguredCache({
  maxAge: ONE_DAY,
  version: 1,
  name: 'sicnaTagsRaw',
})

const SICNA_TAGS_URL = '/api/wp_cache/sicna_tags'

export function loadSicnaTags() {
  return sicnaTagsCache.get('all').then((cached) => {
    if (cached && cached.length) return cached
    return fetch(SICNA_TAGS_URL, { headers: { Accept: 'application/json' } })
      .then((r) => {
        if (!r.ok) throw new Error(`sicna_tags ${r.status}`)
        return r.json()
      })
      .then((rows) => {
        if (rows && rows.length) sicnaTagsCache.set('all', rows)
        return rows
      })
  })
}
