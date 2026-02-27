import { createAsyncResourceBundle, createSelector } from 'redux-bundler'
import { fetchAll } from '../utils/wp_fetch'

const sorghumFundedProjects = createAsyncResourceBundle({
  name: 'sorghumFundedProjects',
  actionBaseType: 'SORGHUM_FUNDED_PROJECTS',
  persist: true,
  getPromise: ({store}) => {
    return fetchAll(`https://content.sorghumbase.org/wordpress/index.php/wp-json/wp/v2/project`)
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
