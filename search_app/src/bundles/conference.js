import { createAsyncResourceBundle, createSelector } from 'redux-bundler'
import _ from 'lodash'
import fetchAll from '../utils/wp_fetch'

const sorghumConference = createAsyncResourceBundle({
  name: 'sorghumConference',
  actionBaseType: 'SORGHUM_CONFERENCE',
  persist: true,
  getPromise: ({store}) => {
    return fetchAll(`https://content.sorghumbase.org/wordpress/index.php/wp-json/wp/v2/conference`)
      .then(conferences => _.keyBy(conferences, 'slug'))
  }
});
sorghumConference.reactSorghumConference = createSelector(
  'selectSorghumConferenceShouldUpdate',
  (shouldUpdate) => {
    if (shouldUpdate) {
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
    return fetchAll(`https://content.sorghumbase.org/wordpress/index.php/wp-json/wp/v2/conference_session`)
      .then(sessions => sessions.sort(compareStartTime))
  }
});
sorghumSessions.reactSorghumSessions = createSelector(
  'selectSorghumSessionsShouldUpdate',
  (shouldUpdate) => {
    if (shouldUpdate) {
      return { actionCreator: 'doFetchSorghumSessions' }
    }
  }
);

const sorghumAbstracts = createAsyncResourceBundle({
  name: 'sorghumAbstracts',
  actionBaseType: 'SORGHUM_ABSTRACTS',
  persist: true,
  getPromise: ({store}) => {
    return fetchAll(`https://content.sorghumbase.org/wordpress/index.php/wp-json/wp/v2/conference_abstract?orderby=date&order=asc`)
      .then(abstracts => _.groupBy(abstracts,'session'))
  }
});
sorghumAbstracts.reactSorghumAbstracts = createSelector(
  'selectSorghumAbstractsShouldUpdate',
  (shouldUpdate) => {
    if (shouldUpdate) {
      return { actionCreator: 'doFetchSorghumAbstracts' }
    }
  }
);

const sorghumPeople = createAsyncResourceBundle({
  name: 'sorghumPeople',
  actionBaseType: 'SORGHUM_PEOPLE',
  persist: false,
  getPromise: ({store}) => {
    return fetchAll(`https://content.sorghumbase.org/wordpress/index.php/wp-json/wp/v2/conference_person`)
      .then(people => _.keyBy(people,'id'))
  }
});
sorghumPeople.reactSorghumPeople = createSelector(
  'selectSorghumPeopleShouldUpdate',
  (shouldUpdate) => {
    if (shouldUpdate) {
      return { actionCreator: 'doFetchSorghumPeople' }
    }
  }
);

const sorghumOrganizations = createAsyncResourceBundle({
  name: 'sorghumOrganizations',
  actionBaseType: 'SORGHUM_ORGANIZATIONS',
  persist: false,
  getPromise: ({store}) => {
    return fetchAll(`https://content.sorghumbase.org/wordpress/index.php/wp-json/wp/v2/organization`)
      .then(orgs => _.keyBy(orgs,'id'))
  }
});
sorghumOrganizations.reactSorghumOrganizations = createSelector(
  'selectSorghumOrganizationsShouldUpdate',
  (shouldUpdate) => {
    if (shouldUpdate) {
      return { actionCreator: 'doFetchSorghumOrganizations' }
    }
  }
);

const sicnaTags = createAsyncResourceBundle({
  name: 'sicnaTags',
  actionBaseType: 'SICNA_TAGS',
  persist: false,
  getPromise: ({store}) => {
    return fetchAll(`https://content.sorghumbase.org/wordpress/index.php/wp-json/wp/v2/tags?search=sicna`)
      .then(tags => _.keyBy(tags,'id'))
  }
});
sicnaTags.reactSicnaTags = createSelector(
  'selectSicnaTagsShouldUpdate',
  (shouldUpdate) => {
    if (shouldUpdate) {
      return { actionCreator: 'doFetchSicnaTags' }
    }
  }
);

const sorghumDocs = {
  name: 'sorghumDocs',
  getReducer: () => {
    const initialState = {
      media: {},
      people: {}
    };
    const initializeToState = (state, key, payload) => {
      let newStateInfo = {...state[key]};
      payload.forEach(id => {
        if (!state[key].hasOwnProperty(id)) newStateInfo[id] = {};
      })
      return newStateInfo;
    }
    const assignToState = (state, key, items) => {
      let newState = {...state[key]};
      items.forEach(item => {
        newState[item.id] = item;
      });
      return newState;
    };

    const reducer = (state = initialState, {type, payload}) => {
      switch (type) {
        case 'SORGHUM_MEDIA_REQUESTED':
          return {
            ...state,
            media: initializeToState(state, 'media', payload)
          };
        case 'SORGHUM_MEDIA_RECEIVED':
          return {
            ...state,
            media: assignToState(state, 'media', payload)
          };
        case 'SORGHUM_PEOPLE_REQUESTED':
          return {
            ...state,
            people: initializeToState(state, 'people', payload)
          };
        case 'SORGHUM_PEOPLE_RECEIVED':
          return {
            ...state,
            people: assignToState(state, 'people', payload)
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
      // dispatch({ type: 'SORGHUM_MEDIA_REQUESTED', payload: idsToFetch })
      return fetchAll(`https://content.sorghumbase.org/wordpress/index.php/wp-json/wp/v2/media?include=${idsToFetch.join(',')}`)
        .then(media => {
          dispatch({ type: 'SORGHUM_MEDIA_RECEIVED', payload: media });
        });
    }
  },
  doRequestPeople: ids => ({dispatch, store}) => {
    const people = store.selectSorghumPeople();
    const idsToFetch = ids.filter(id => !people.hasOwnProperty(id));
    if (idsToFetch.length > 0) {
      dispatch({ type: 'SORGHUM_PEOPLE_REQUESTED', payload: idsToFetch })
      return fetchAll(`https://content.sorghumbase.org/wordpress/index.php/wp-json/wp/v2/conference_person?include=${idsToFetch.join(',')}`)
        .then(people => {
          dispatch({ type: 'SORGHUM_PEOPLE_RECEIVED', payload: people });
        });
    }
  },
  selectSorghumMedia: state => state.sorghumDocs.media,
  // selectSorghumPeople: state => state.sorghumDocs.people
}
export default [sorghumConference,sorghumSessions,sorghumAbstracts,sorghumPeople,sorghumOrganizations,sicnaTags,sorghumDocs];
