import { composeBundles, createCacheBundle } from 'redux-bundler'
import {bundles as grameneBundles} from 'gramene-search'
import UIbundle from './searchUI'
import typeaheadBundle from './typeahead.js'
import conferenceBundles from './conference.js'
import workingGroupBundles from './workingGroups.js'
import fundedProjectsBundles from './fundedProjects.js'
import publicationsBundles from './publications.js'
import cache from "../utils/cache"
import initialState from '../../config.json';

// Firebase web config is loaded from FIREBASE_CONFIG_JSON in the build-time
// env (.env, never committed). If unset, the Auth panel mounts but stays
// inert.
(() => {
  const raw = process.env.FIREBASE_CONFIG_JSON;
  if (!raw) return;
  try { initialState.firebaseConfig = JSON.parse(raw); }
  catch (e) { console.warn('FIREBASE_CONFIG_JSON is not valid JSON; Auth disabled.', e); }
})();


const config = {
  name: 'config',
  getReducer: () => {
    return (state = initialState) => {
      return state;
    }
  },
  selectGrameneAPI: state => state.config.grameneData,
  selectEnsemblAPI: state => state.config.ensemblRest,
  selectTargetTaxonId: state => state.config.targetTaxonId,
  selectCuration: state => state.config.curation,
  selectConfiguration: state => state.config
  // selectEnsemblURL: state => state.config.ensemblSite,
  // selectGrameneAPI: state => state.config.grameneData,
  // selectTargetTaxonId: state => state.config.targetTaxonId,
  // selectCuration: state => state.config.curation,
  // selectAlertMessage: state => state.config.alertText
};

const bundle = composeBundles(
  ...grameneBundles,
  ...conferenceBundles,
  ...workingGroupBundles,
  ...fundedProjectsBundles,
  ...publicationsBundles,
  UIbundle,
  typeaheadBundle,
  config,
  createCacheBundle(cache.set)
);


export default bundle;
