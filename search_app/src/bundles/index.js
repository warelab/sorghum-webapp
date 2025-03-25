import { composeBundles, createCacheBundle } from 'redux-bundler'
import {bundles as sorghumBundles} from 'sorghum-search'
import {bundles as grameneBundles} from 'gramene-search'
import UIbundle from './searchUI'
import conferenceBundles from './conference.js'
import workingGroupBundles from './workingGroups.js'
import fundedProjectsBundles from './fundedProjects.js'
import cache from "../utils/cache"
import initialState from '../../config.json';


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
  ...sorghumBundles,
  ...grameneBundles,
  ...conferenceBundles,
  ...workingGroupBundles,
  ...fundedProjectsBundles,
  UIbundle,
  config,
  createCacheBundle(cache.set)
);


export default bundle;
