// Stale-while-revalidate for the /api/wp_cache loaders.
//
// Every loader used to await /api/wp_cache/_timestamps before it would hand back
// even a locally cached copy:
//
//   if (!local) return fetchAndCache()
//   return expectedTimestamp(RESOURCE).then(serverTs =>
//     serverTs > local.fetched_at ? fetchAndCache() : local.data)
//
// so a warm cache still blocked first paint on a network round trip. This helper
// keeps the same freshness guarantee but stops making the reader wait for it:
// cached data resolves immediately, the timestamp check runs in the background,
// and if the server's copy turns out to be newer the refetched data is handed to
// `onFresh` for a second render.
//
// Callers that pass no `onFresh` still get the revalidation — the newer data
// lands in the cache for next time, it just isn't pushed into the current view.

import { expectedTimestamp } from './wp_cache_timestamps'

/**
 * @param {object}   opts
 * @param {?object}  opts.cached   `{data, fetched_at}` from the local cache, or null
 * @param {string}   opts.resource resource key in the _timestamps map
 * @param {function} opts.refetch  () => Promise<data>, and writes the cache
 * @param {function} [opts.onFresh] called with newer data when revalidation finds some
 * @returns {Promise<*>} cached data straight away, or the network result when cold
 */
export function staleWhileRevalidate({ cached, resource, refetch, onFresh }) {
  // Nothing usable stored — the caller has to wait for the network.
  if (!cached) return refetch()

  Promise.resolve()
    .then(() => expectedTimestamp(resource))
    .then((serverTs) => {
      // null means "no signal" — keep what we have rather than refetch blindly.
      if (serverTs === null || serverTs <= cached.fetched_at) return null
      return refetch()
    })
    .then((fresh) => {
      if (fresh && typeof onFresh === 'function') onFresh(fresh)
    })
    .catch(() => {
      // Revalidation is best-effort; the cached copy stays on screen.
    })

  return Promise.resolve(cached.data)
}
