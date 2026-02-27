import { createAsyncResourceBundle, createSelector } from 'redux-bundler'
import { fetchAll } from '../utils/wp_fetch'

const sorghumWorkingGroups = createAsyncResourceBundle({
  name: 'sorghumWorkingGroups',
  actionBaseType: 'SORGHUM_WORKING_GROUPS',
  persist: true,
  getPromise: ({store}) => {
    return fetchAll(`https://content.sorghumbase.org/wordpress/index.php/wp-json/wp/v2/working_group`)
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
