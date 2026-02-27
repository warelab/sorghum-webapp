import { createAsyncResourceBundle, createSelector } from 'redux-bundler'
import { count, fetchAll } from '../utils/wp_fetch'

const sorghumPublicationsTally = createAsyncResourceBundle({
  name: 'sorghumPublicationsTally',
  actionBaseType: 'SORGHUM_PUBLICATIONS_TALLY',
  persist: false,
  getPromise: ({store}) => {
    return count(`https://content.sorghumbase.org/wordpress/index.php/wp-json/wp/v2/scientific_paper`)
      .then(pubs => pubs)
  }
});
sorghumPublicationsTally.reactSorghumPublicationsTally = createSelector(
  'selectSorghumPublicationsTallyShouldUpdate',
  'selectPathname',
  (shouldUpdate, pathname) => {
    if (shouldUpdate && pathname === '/publications') {
      return { actionCreator: 'doFetchSorghumPublicationsTally' }
    }
  }
);

const sorghumPublications = createAsyncResourceBundle({
  name: 'sorghumPublications',
  actionBaseType: 'SORGHUM_PUBLICATIONS',
  persist: true,
  getPromise: ({store}) => {
    return fetchAll(`https://content.sorghumbase.org/wordpress/index.php/wp-json/wp/v2/scientific_paper`)
      .then(pubs => pubs)
  }
});
sorghumPublications.reactSorghumPublications = createSelector(
  'selectSorghumPublicationsShouldUpdate',
  'selectSorghumPublicationsTally',
  'selectSorghumPublications',
  'selectPathname',
  (shouldUpdate, tally, pubs, pathname) => {
    if (pathname === '/publications') {
      if ((shouldUpdate && !pubs) || (tally && pubs && tally > pubs.length)) {
        return { actionCreator: 'doFetchSorghumPublications' }
      }
    }
  }
);

const sorghumTagsTally = createAsyncResourceBundle({
  name: 'sorghumTagsTally',
  actionBaseType: 'SORGHUM_TAGS_TALLY',
  persist: false,
  getPromise: ({store}) => {
    return count(`https://content.sorghumbase.org/wordpress/index.php/wp-json/wp/v2/tags`)
      .then(pubs => pubs)
  }
});
sorghumTagsTally.reactSorghumTagsTally = createSelector(
  'selectSorghumTagsTallyShouldUpdate',
  'selectPathname',
  (shouldUpdate, pathname) => {
    if (shouldUpdate && pathname === '/publications') {
      return { actionCreator: 'doFetchSorghumTagsTally' }
    }
  }
);

const sorghumTags = createAsyncResourceBundle({
  name: 'sorghumTags',
  actionBaseType: 'SORGHUM_TAGS',
  persist: true,
  getPromise: ({store}) => {
    return fetchAll(`https://content.sorghumbase.org/wordpress/index.php/wp-json/wp/v2/tags`)
      .then(tags => {
        let tag2Name = {};
        tags.forEach(tag => { tag2Name[tag.id] = tag.name});
        return tag2Name;
      })
  }
});
sorghumTags.reactSorghumTags = createSelector(
  'selectSorghumTagsShouldUpdate',
  'selectSorghumTagsTally',
  'selectSorghumTags',
  'selectPathname',
  (shouldUpdate, tally, tags, pathname) => {
    if (pathname === '/publications') {
      if ((shouldUpdate && !tags) || (tally && tags && tally > Object.keys(tags).length)) {
        return { actionCreator: 'doFetchSorghumTags' }
      }
    }
  }
);

export default [sorghumPublications, sorghumPublicationsTally, sorghumTags, sorghumTagsTally];
