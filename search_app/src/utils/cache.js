import { getConfiguredCache } from 'money-clip'

// This just creates a cache helper that is pre-configured
// these options.
// The version number should come from a config, this protects
// from trying load cached data when the internal data structures
// that your app expects have changed.
//
// Additionally, if you're caching user-specific data, you should build a
// version string that includes some user identifier along with your actual
// version number. This will ensure tha switching users won't result in
// someone loading someone else's cached data.
//
// So, there are gotchas, but it sure is cool when you've got it all set up.
// The server-side cache (controllers/wp_cache.py) gives us a cheap meta
// endpoint to detect when local data is stale, so we can keep the browser
// copy around for much longer than the redux-bundler stale window.
export default getConfiguredCache({
  maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days
  // Bumped when bundle persistence semantics change. Old entries (e.g.
  // sorghumTags / sorghumPublications stored when those bundles had
  // persist:true) shouldn't hydrate the new shape on boot.
  version: 2
})