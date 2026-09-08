import { getConfiguredCache } from 'money-clip'
import initialState from '../../config.json'

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
// Bumped when bundle persistence semantics change. Old entries from bundles
// whose persist:true was removed (sorghumTags, sorghumPublications,
// sorghumFundedProjects, sorghumWorkingGroups, sorghumConference,
// sorghumAbstracts) shouldn't hydrate the new shape on boot.
const SCHEMA_VERSION = 3

// The data release these entries were fetched from, e.g. "sorghum_v11".
//
// Several persisted bundles are release-scoped — grameneTaxonomy and
// grameneMaps describe the genomes in one release. Pointing the site at a new
// release used to leave those stale for up to the bundle's own staleAfter (24h
// for taxonomy), and a taxonomy that predates a newly added genome is not just
// out of date: it made every suggestion referencing that genome throw, which
// emptied the search box (fixed defensively in gramene-search 2.18.1, but the
// stale data was the cause).
//
// money-clip compares the stored version with `!==` and drops anything that
// doesn't match, so folding the release into the version invalidates them the
// moment grameneData changes rather than waiting for them to age out.
const dataRelease = String(initialState.grameneData || '')
  .replace(/\/+$/, '')
  .split('/')
  .pop() || 'unknown'

export default getConfiguredCache({
  // No age-based eviction: wp_cache's server-side change detection +
  // /api/wp_cache/_timestamps is the source of truth for staleness.
  maxAge: Infinity,
  version: `${SCHEMA_VERSION}:${dataRelease}`
})