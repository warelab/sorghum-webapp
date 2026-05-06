import { createAsyncResourceBundle, createSelector } from 'redux-bundler'
import { fetchAllCached } from '../utils/wp_fetch'

const sorghumFundedProjects = createAsyncResourceBundle({
  name: 'sorghumFundedProjects',
  actionBaseType: 'SORGHUM_FUNDED_PROJECTS',
  persist: true,
  getPromise: ({store}) => {
    return fetchAllCached(`/api/wp_cache/projects`)
      .then(projects => projects)
  }
});
sorghumFundedProjects.reactSorghumFundedProjects = createSelector(
  'selectSorghumFundedProjectsShouldUpdate',
  'selectPathname',
  (shouldUpdate, pathname) => {
    if (shouldUpdate && pathname === '/projects') {
      return { actionCreator: 'doFetchSorghumFundedProjects' }
    }
  }
);

export default [sorghumFundedProjects];
