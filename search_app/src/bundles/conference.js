import { createAsyncResourceBundle, createSelector } from 'redux-bundler'
import _ from 'lodash'
import { fetchAllCached } from '../utils/wp_fetch'

const sorghumConference = createAsyncResourceBundle({
  name: 'sorghumConference',
  actionBaseType: 'SORGHUM_CONFERENCE',
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

export default [sorghumConference,sorghumSessions,sorghumAbstracts,sorghumPeople,sorghumOrganizations,sicnaTags];
