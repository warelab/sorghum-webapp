export function count(apiUrl) {
  const url = new URL(apiUrl);
  url.searchParams.set('per_page', '1');
  url.searchParams.set('skip_cache', '1')
  return fetch(url)
    .then(response => {
      const xWpTotal = response.headers.get('X-Wp-Total');
      return +xWpTotal;
    })
    .catch(error => {
      console.error('Error fetching data:', error);
      // Propagate the error
      throw error;
    });
}

// Lightweight count check against the Flask-side cache.
// /api/wp_cache/<resource>/meta returns {count, fetched_at, ...}.
export function countCached(metaUrl) {
  return fetch(metaUrl, { headers: { Accept: 'application/json' } })
    .then(r => {
      if (!r.ok) throw new Error(`meta ${r.status}`);
      return r.json();
    })
    .then(meta => +meta.count)
    .catch(error => {
      console.error('Error fetching cached meta:', error);
      throw error;
    });
}

// Single-shot fetch of a fully-assembled list from the Flask-side cache.
// onProgress is called once with (count, count) so the existing progress
// bar wiring stays happy.
export function fetchAllCached(dataUrl, onProgress) {
  return fetch(dataUrl, { headers: { Accept: 'application/json' } })
    .then(r => {
      if (!r.ok) throw new Error(`cache ${r.status}`);
      return r.json();
    })
    .then(items => {
      if (onProgress) onProgress(items.length, items.length);
      return items;
    })
    .catch(error => {
      console.error('Error fetching cached data:', error);
      throw error;
    });
}
