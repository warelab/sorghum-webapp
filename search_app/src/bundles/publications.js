import { createAsyncResourceBundle, createSelector } from 'redux-bundler'
import publicationsProgress from './publicationsProgress'
import { loadPublications } from '../utils/publications_cache'
import { loadTags } from '../utils/tags_cache'
import { expectedCount } from '../utils/typesense_counts'

// The tally bundles now hold the *expected* count from Typesense rather than
// querying /api/wp_cache/<r>/meta. The data bundles fetch through the shared
// money-clip-backed loaders (same caches paperDetail uses), so visiting
// /paper/<slug> and /publications shares one fetch.

const sorghumPublicationsTally = createAsyncResourceBundle({
  name: 'sorghumPublicationsTally',
  actionBaseType: 'SORGHUM_PUBLICATIONS_TALLY',
  persist: false,
  getPromise: () => expectedCount('papers').then((n) => n || 0),
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
  // Persisted in money-clip publicationsRaw, no need to also persist via
  // the redux-bundler IndexedDB layer.
  persist: false,
  getPromise: ({ store }) => {
    store.doSetPubProgress(0, 0);
    return loadPublications().then((pubs) => {
      if (pubs && pubs.length) store.doSetPubProgress(pubs.length, pubs.length);
      store.doResetPubProgress();
      return pubs;
    });
  }
});
sorghumPublications.reactSorghumPublications = createSelector(
  'selectSorghumPublicationsShouldUpdate',
  'selectSorghumPublicationsTally',
  'selectSorghumPublications',
  'selectPathname',
  (shouldUpdate, tally, pubs, pathname) => {
    if (pathname === '/publications') {
      if ((shouldUpdate && !pubs) || (tally && pubs && tally !== pubs.length)) {
        return { actionCreator: 'doFetchSorghumPublications' }
      }
    }
  }
);

const sorghumTagsTally = createAsyncResourceBundle({
  name: 'sorghumTagsTally',
  actionBaseType: 'SORGHUM_TAGS_TALLY',
  persist: false,
  getPromise: () => expectedCount('tags').then((n) => n || 0),
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
  persist: false,
  getPromise: () => loadTags().then((tags) => {
    const lookup = {};
    (tags || []).forEach((t) => { if (t && t.id) lookup[t.id] = t.name });
    return lookup;
  }),
});
sorghumTags.reactSorghumTags = createSelector(
  'selectSorghumTagsShouldUpdate',
  'selectSorghumTagsTally',
  'selectSorghumTags',
  'selectPathname',
  (shouldUpdate, tally, tags, pathname) => {
    if (pathname === '/publications') {
      const have = tags ? Object.keys(tags).length : 0;
      if ((shouldUpdate && !tags) || (tally && tags && tally !== have)) {
        return { actionCreator: 'doFetchSorghumTags' }
      }
    }
  }
);

export default [sorghumPublications, sorghumPublicationsTally, sorghumTags, sorghumTagsTally, publicationsProgress];
