import { render } from 'react-dom'
import getStore from './bundles'
import cache from './utils/cache'
import SearchBar from './components/searchbar'

cache.getAll().then(initialData => {
  if (initialData) {
    console.log('starting with locally cached data:', initialData)
  }
  const store = getStore(initialData);
  render(SearchBar(store), document.getElementById('sorghumbase-searchbar'));
})
