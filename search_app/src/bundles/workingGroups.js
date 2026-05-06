import { createAsyncResourceBundle, createSelector } from 'redux-bundler'
import { fetchAllCached } from '../utils/wp_fetch'

const sorghumWorkingGroups = createAsyncResourceBundle({
  name: 'sorghumWorkingGroups',
  actionBaseType: 'SORGHUM_WORKING_GROUPS',
  persist: true,
  getPromise: ({store}) => {
    return fetchAllCached(`/api/wp_cache/working_groups`)
      .then(groups => groups)
  }
});
sorghumWorkingGroups.reactSorghumWorkingGroups = createSelector(
  'selectSorghumWorkingGroupsShouldUpdate',
  'selectPathname',
  (shouldUpdate,pathname) => {
    if (shouldUpdate && pathname === '/workingGroups') {
      return { actionCreator: 'doFetchSorghumWorkingGroups' }
    }
  }
);

export default [sorghumWorkingGroups];
