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

// Per-site settings (sorghum_webapp configuration_files/live.cfg or dev.cfg,
// chosen by TARGET_SITE) that base.html writes into window.SORGHUMBASE_SITE
// before loading this bundle. They override config.json -- `details` key by
// key -- so one build serves both sites. Without them (a standalone dev page)
// config.json's live defaults apply.
(() => {
  const site = typeof window !== 'undefined' && window.SORGHUMBASE_SITE;
  if (!site) return;
  const {details, ...rest} = site;
  Object.entries(rest).forEach(([key, value]) => {
    if (value !== null && value !== undefined) initialState[key] = value;
  });
  if (details) initialState.details = {...initialState.details, ...details};
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
  selectCuration: state => state.config.curation,
  selectConfiguration: state => state.config
  // selectEnsemblURL: state => state.config.ensemblSite,
  // selectGrameneAPI: state => state.config.grameneData,
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
