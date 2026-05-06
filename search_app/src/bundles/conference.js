import { createAsyncResourceBundle, createSelector } from 'redux-bundler'
import _ from 'lodash'
import { fetchAll, fetchAllCached } from '../utils/wp_fetch'

const sorghumConference = createAsyncResourceBundle({
  name: 'sorghumConference',
  actionBaseType: 'SORGHUM_CONFERENCE',
  persist: true,
  getPromise: ({store}) => {
    return fetchAllCached(`/api/wp_cache/conferences`)
      .then(conferences => _.keyBy(conferences, 'slug'))
  }
});
sorghumConference.reactSorghumConference = createSelector(
  'selectSorghumConferenceShouldUpdate',
  'selectPathname',
  (shouldUpdate, pathname) => {
    if (shouldUpdate && pathname === '/conferences') {
      return { actionCreator: 'doFetchSorghumConference' }
    }
  }
);
// Comparison function for sorting
function compareStartTime(a, b) {
  var startTimeA = new Date(a.start_time);
  var startTimeB = new Date(b.start_time);
  return startTimeA - startTimeB;
}

const sorghumSessions = createAsyncResourceBundle({
  name: 'sorghumSessions',
  actionBaseType: 'SORGHUM_SESSIONS',
  persist: false,
  getPromise: ({store}) => {
    return fetchAllCached(`/api/wp_cache/conference_sessions`)
      .then(sessions => sessions.sort(compareStartTime))
  }
});
sorghumSessions.reactSorghumSessions = createSelector(
  'selectSorghumSessionsShouldUpdate',
  'selectPathname',
  (shouldUpdate, pathname) => {
    if (shouldUpdate && pathname === '/conferences') {
      return { actionCreator: 'doFetchSorghumSessions' }
    }
  }
);

const sorghumAbstracts = createAsyncResourceBundle({
  name: 'sorghumAbstracts',
  actionBaseType: 'SORGHUM_ABSTRACTS',
  persist: true,
  getPromise: ({store}) => {
    return fetchAllCached(`/api/wp_cache/conference_abstracts`)
      .then(abstracts => _.groupBy(abstracts,'session'))
  }
});
sorghumAbstracts.reactSorghumAbstracts = createSelector(
  'selectSorghumAbstractsShouldUpdate',
  'selectPathname',
  (shouldUpdate, pathname) => {
    if (shouldUpdate && pathname === '/conferences') {
      return { actionCreator: 'doFetchSorghumAbstracts' }
    }
  }
);

const sorghumPeople = createAsyncResourceBundle({
  name: 'sorghumPeople',
  actionBaseType: 'SORGHUM_PEOPLE',
  persist: false,
  getPromise: ({store}) => {
    return fetchAllCached(`/api/wp_cache/conference_people`)
      .then(people => _.keyBy(people,'id'))
  }
});
sorghumPeople.reactSorghumPeople = createSelector(
  'selectSorghumPeopleShouldUpdate',
  'selectPathname',
  (shouldUpdate, pathname) => {
    if (shouldUpdate && pathname === '/conferences') {
      return { actionCreator: 'doFetchSorghumPeople' }
    }
  }
);

const sorghumOrganizations = createAsyncResourceBundle({
  name: 'sorghumOrganizations',
  actionBaseType: 'SORGHUM_ORGANIZATIONS',
  persist: false,
  getPromise: ({store}) => {
    return fetchAllCached(`/api/wp_cache/organizations`)
      .then(orgs => _.keyBy(orgs,'id'))
  }
});
sorghumOrganizations.reactSorghumOrganizations = createSelector(
  'selectSorghumOrganizationsShouldUpdate',
  'selectPathname',
  (shouldUpdate, pathname) => {
    if (shouldUpdate && pathname === '/conferences') {
      return { actionCreator: 'doFetchSorghumOrganizations' }
    }
  }
);

const sicnaTags = createAsyncResourceBundle({
  name: 'sicnaTags',
  actionBaseType: 'SICNA_TAGS',
  persist: false,
  getPromise: ({store}) => {
    return fetchAllCached(`/api/wp_cache/sicna_tags`)
      .then(tags => _.keyBy(tags,'id'))
  }
});
sicnaTags.reactSicnaTags = createSelector(
  'selectSicnaTagsShouldUpdate',
  'selectPathname',
  (shouldUpdate, pathname) => {
    if (shouldUpdate && pathname === '/conferences') {
      return { actionCreator: 'doFetchSicnaTags' }
    }
  }
);

const sorghumDocs = {
  name: 'sorghumDocs',
  getReducer: () => {
    const initialState = {
      media: {}
    };
    const assignToState = (state, key, items) => {
      let newState = {...state[key]};
      items.forEach(item => {
        newState[item.id] = item;
      });
      return newState;
    };

    const reducer = (state = initialState, {type, payload}) => {
      switch (type) {
        case 'SORGHUM_MEDIA_RECEIVED':
          return {
            ...state,
            media: assignToState(state, 'media', payload)
          };
        default:
          return state;
      }
    }
    return reducer;
  },
  doRequestMedia: ids => ({dispatch, store}) => {
    const media = store.selectSorghumMedia();
    const idsToFetch = ids.filter(id => !media.hasOwnProperty(id));
    if (idsToFetch.length > 0) {
      return fetchAll(`https://content.sorghumbase.org/wordpress/index.php/wp-json/wp/v2/media?include=${idsToFetch.join(',')}`)
        .then(media => {
          dispatch({ type: 'SORGHUM_MEDIA_RECEIVED', payload: media });
        });
    }
  },
  selectSorghumMedia: state => state.sorghumDocs.media
}
export default [sorghumConference,sorghumSessions,sorghumAbstracts,sorghumPeople,sorghumOrganizations,sicnaTags,sorghumDocs];
