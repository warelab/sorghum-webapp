// Fetch num_documents per Typesense collection. Used by React components
// that cache full lists in money-clip (IndexedDB) to detect when the local
// cache is stale: if the cached array length doesn't match the count from
// Typesense, the component invalidates and refetches.
//
// One in-flight promise is shared across callers so multiple components
// mounting on the same page don't each hit the endpoint.

let inflight = null;
let lastValue = null;
let lastFetched = 0;

const TTL_MS = 30 * 1000;

export function getTypesenseCounts() {
  const now = Date.now();
  if (lastValue && now - lastFetched < TTL_MS) {
    return Promise.resolve(lastValue);
  }
  if (inflight) return inflight;
  inflight = fetch('/api/typesense/counts', { headers: { Accept: 'application/json' } })
    .then((r) => {
      if (!r.ok) throw new Error(`counts ${r.status}`);
      return r.json();
    })
    .then((counts) => {
      lastValue = counts || {};
      lastFetched = Date.now();
      inflight = null;
      return lastValue;
    })
    .catch((e) => {
      inflight = null;
      throw e;
    });
  return inflight;
}

// Returns the expected count for `collectionName`, or null if Typesense is
// unavailable / collection is missing / count not yet known. Callers should
// treat null as "no signal — keep using whatever you have."
export function expectedCount(collectionName) {
  return getTypesenseCounts()
    .then((counts) => {
      const v = counts && counts[collectionName];
      return typeof v === 'number' ? v : null;
    })
    .catch(() => null);
}
