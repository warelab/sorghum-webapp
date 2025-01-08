export default function fetchAll(apiUrl, resultsPerPage = 100) {
  let totalPages;
  let allResults = [];
  const url = new URL(apiUrl);
  url.searchParams.set('per_page', resultsPerPage);

  // Fetch the first page to get the total number of pages
  return fetch(url)
    .then(response => {
      const xWpTotal = response.headers.get('X-Wp-Total');
      totalPages = Math.ceil(xWpTotal / resultsPerPage);
      return response.json();
    })
    .then(data => {
      // Add the results of the first page to the combined array
      allResults = allResults.concat(data);

      // Fetch the remaining pages
      const fetchPages = [];
      for (let pageNum = 2; pageNum <= totalPages; pageNum++) {
        const page_url = new URL(url);
        page_url.searchParams.set('page', pageNum);
        fetchPages.push(fetch(page_url));
      }

      // Combine results from all pages
      return Promise.all(fetchPages.map(p => p.then(response => response.json())));
    })
    .then(pageDataArray => {
      // Concatenate results from all pages into a single array
      pageDataArray.forEach(pageData => {
        allResults = allResults.concat(pageData);
      });

      // Return the combined results
      return allResults;
    })
    .catch(error => {
      console.error('Error fetching data:', error);
      // Propagate the error
      throw error;
    });
}
