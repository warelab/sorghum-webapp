import { createAsyncResourceBundle, createSelector } from 'redux-bundler'
import publicationsProgress from './publicationsProgress'
import { loadPublications } from '../utils/publications_cache'
import { loadTags } from '../utils/tags_cache'
import { expectedTimestamp } from '../utils/wp_cache_timestamps'

// The tally bundles now hold the server-reported `fetched_at` timestamp
// from /api/wp_cache/_timestamps rather than a count. When the server
// timestamp moves forward, the data bundle's reactor sees the mismatch
// and triggers a refetch through the shared money-clip-backed loaders
// (same caches paperDetail uses), so visiting /paper/<slug> and
// /publications shares one fetch.

const sorghumPublicationsTally = createAsyncResourceBundle({
  name: 'sorghumPublicationsTally',
  actionBaseType: 'SORGHUM_PUBLICATIONS_TALLY',
  persist: false,
  getPromise: () => expectedTimestamp('publications').then((n) => n || 0),
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
// loadPublications already compares the server's fetched_at against the
// money-clip stamp internally; we just need the reactor to call it again
// whenever the tally bundle reports a newer timestamp than the last
// successful publications fetch.
sorghumPublications.reactSorghumPublications = createSelector(
  'selectSorghumPublicationsShouldUpdate',
  'selectSorghumPublicationsTally',
  'selectSorghumPublications',
  'selectSorghumPublicationsLastSuccess',
  'selectPathname',
  (shouldUpdate, tally, pubs, lastSuccessMs, pathname) => {
    if (pathname !== '/publications') return;
    if (shouldUpdate && !pubs) return { actionCreator: 'doFetchSorghumPublications' };
    // tally is the server's fetched_at in epoch seconds; lastSuccess is the
    // client's Date.now() in ms. Convert and compare.
    if (tally && lastSuccessMs && tally * 1000 > lastSuccessMs) {
      return { actionCreator: 'doFetchSorghumPublications' };
    }
  }
);

const sorghumTagsTally = createAsyncResourceBundle({
  name: 'sorghumTagsTally',
  actionBaseType: 'SORGHUM_TAGS_TALLY',
  persist: false,
  getPromise: () => expectedTimestamp('tags').then((n) => n || 0),
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
  'selectSorghumTagsLastSuccess',
  'selectPathname',
  (shouldUpdate, tally, tags, lastSuccessMs, pathname) => {
    if (pathname !== '/publications') return;
    if (shouldUpdate && !tags) return { actionCreator: 'doFetchSorghumTags' };
    if (tally && lastSuccessMs && tally * 1000 > lastSuccessMs) {
      return { actionCreator: 'doFetchSorghumTags' };
    }
  }
);

export default [sorghumPublications, sorghumPublicationsTally, sorghumTags, sorghumTagsTally, publicationsProgress];
