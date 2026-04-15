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
export function fetchAll(apiUrl, resultsPerPage = 100, onProgress) {
  let totalPages;
  let totalItems;
  let allResults = [];
  const url = new URL(apiUrl);
  url.searchParams.set('per_page', resultsPerPage);
  url.searchParams.set('skip_cache', '1')

  // Fetch the first page to get the total number of pages
  return fetch(url)
    .then(response => {
      const xWpTotal = response.headers.get('X-Wp-Total');
      totalItems = +xWpTotal;
      totalPages = Math.ceil(totalItems / resultsPerPage);
      return response.json();
    })
    .then(data => {
      // Add the results of the first page to the combined array
      allResults = allResults.concat(data);
      if (onProgress) onProgress(allResults.length, totalItems);

      // Fetch the remaining pages
      const fetchPages = [];
      for (let pageNum = 2; pageNum <= totalPages; pageNum++) {
        const page_url = new URL(url);
        page_url.searchParams.set('page', pageNum);
        fetchPages.push(
          fetch(page_url)
            .then(response => response.json())
            .then(pageData => {
              allResults = allResults.concat(pageData);
              if (onProgress) onProgress(allResults.length, totalItems);
              return pageData;
            })
        );
      }

      return Promise.all(fetchPages);
    })
    .then(() => {
      // Return the combined results
      return allResults;
    })
    .catch(error => {
      console.error('Error fetching data:', error);
      // Propagate the error
      throw error;
    });
}
