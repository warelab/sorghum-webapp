import ReactGA from 'react-ga4'
import { createSelector } from 'redux-bundler'

// Only the gramene-search bundles still own their own suggestions state.
// The sorghum side is now served by /api/typeahead (see ./typeahead.js).
const clearSuggestions = [
  { type: 'GRAMENE_SUGGESTIONS_CLEARED' },
  { type: 'SUGGESTIONS_CLEARED' },
];

const UIbundle = {
  name: 'searchUI',
  getReducer: () => {
    const initialState = {
      suggestions_query: '',
      suggestions_tab: 'sorghumbase',
      // Query the visible tab was last decided for, by the user or by the auto-select
      // reactor below. Keeps the reactor from overriding a deliberate click, and lets
      // it re-evaluate when the query changes.
      tab_decided_for: null,
    };
    return (state = initialState, { type, payload }) => {
      if (type === 'SUGGESTIONS_QUERY_CHANGED') {
        return { ...state, suggestions_query: payload.query, tab_decided_for: null };
      }
      if (type === 'SUGGESTIONS_TAB_CHANGED') {
        return { ...state, suggestions_tab: payload.key, tab_decided_for: state.suggestions_query };
      }
      // Same effect, but a separate type so it stays out of persistActions — an
      // automatic pick for one query must not overwrite the user's stored preference.
      if (type === 'SUGGESTIONS_TAB_AUTOSELECTED') {
        return { ...state, suggestions_tab: payload.key, tab_decided_for: payload.query };
      }
      if (type === 'SUGGESTIONS_CLEARED') {
        return { ...state, suggestions_query: '', tab_decided_for: null };
      }
      return state;
    };
  },

  persistActions: ['SUGGESTIONS_TAB_CHANGED', 'SUGGESTIONS_CLEARED'],

  doChangeSuggestionsQuery: (query) => ({ dispatch }) => {
    ReactGA.event({
      category: 'search',
      action: 'query',
      label: query.trim(),
    });
    dispatch({
      type: 'BATCH_ACTIONS',
      actions: [
        ...clearSuggestions,
        { type: 'SUGGESTIONS_QUERY_CHANGED', payload: { query: query.trim() } },
      ],
    });
  },

  doClearSuggestions: () => ({ dispatch }) => {
    const el = document.getElementById('sorghumbase-searchbar-parent');
    if (el) el.classList.remove('search-visible');
    dispatch({ type: 'BATCH_ACTIONS', actions: clearSuggestions });
  },

  doAcceptSuggestion: (suggestion) => ({ dispatch, getState }) => {
    const url = new URL(getState().url.url);
    if (url.pathname !== '/genes' && url.pathname !== '/genes.html') {
      if (!suggestion.name) suggestion.name = suggestion.display_name;
      url.pathname = '/genes';
      url.search = `sugg=${JSON.stringify(suggestion)}`;
      window.location = url;
    } else {
      const el = document.getElementById('sorghumbase-searchbar-parent');
      if (el) el.classList.remove('search-visible');
      dispatch({ type: 'BATCH_ACTIONS', actions: clearSuggestions });
    }
  },

  doChangeSuggestionsTab: (key) => ({ dispatch, getState }) => {
    const currentTab = getState().suggestions_tab;
    if (key !== currentTab) {
      dispatch({ type: 'SUGGESTIONS_TAB_CHANGED', payload: { key } });
    }
  },

  selectSearchUI: (state) => state.searchUI,
  selectSuggestionsQuery: (state) => state.searchUI.suggestions_query,
  selectSuggestionsTab: (state) => state.searchUI.suggestions_tab,
  selectPath: (state) => state.pathname,

  // How many hits each tab actually has, once it has settled. `null` means "still
  // loading / not answered yet" so the reactor waits rather than deciding on half the
  // picture; an errored side counts as zero.
  selectSuggestionCounts: createSelector(
    'selectGrameneSuggestionsRaw',
    'selectGrameneSuggestionsIsLoading',
    'selectTypeahead',
    (geneRaw, geneLoading, typeahead) => {
      let genes = null;
      if (!geneLoading) {
        const grouped = geneRaw && geneRaw.data && geneRaw.data.grouped;
        if (grouped && grouped.category) genes = grouped.category.matches || 0;
        else if (geneRaw && geneRaw.error) genes = 0;
      }
      let site = null;
      const t = typeahead || {};
      if (t.status === 'error') site = 0;
      else if (t.status === 'ready') {
        const facets = (t.data && t.data.facets) || {};
        site = Object.values(facets).reduce((acc, n) => acc + (n || 0), 0);
      }
      return { genes, site };
    }
  ),

  // Show the tab that actually has something in it. Gene suggestions used to render
  // into the inactive pane whenever the stored tab was the other one, so a gene query
  // looked like it returned nothing — and a backend outage on one side showed an
  // error where results should be.
  reactAutoSelectSuggestionsTab: createSelector(
    'selectSuggestionsQuery',
    'selectSuggestionsTab',
    'selectSearchUI',
    'selectSuggestionCounts',
    (query, tab, ui, counts) => {
      if (!query) return;
      // Already settled for this query — by the user, or by us. Don't fight a click.
      if (ui.tab_decided_for === query) return;
      // Wait until both sides have answered, or the first to land would always win.
      if (counts.genes === null || counts.site === null) return;
      // Both empty, or both non-empty: no basis to override the stored preference.
      let want = null;
      if (counts.genes > 0 && counts.site === 0) want = 'gramene';
      else if (counts.site > 0 && counts.genes === 0) want = 'sorghumbase';
      if (!want || want === tab) {
        // Still record the decision so this query isn't re-evaluated every tick.
        if (tab) return { actionCreator: 'doSettleSuggestionsTab', args: [tab, query] };
        return;
      }
      return { actionCreator: 'doSettleSuggestionsTab', args: [want, query] };
    }
  ),

  doSettleSuggestionsTab: (key, query) => ({ dispatch }) => {
    dispatch({ type: 'SUGGESTIONS_TAB_AUTOSELECTED', payload: { key, query } });
  },

  selectSorghumSuggestionsStatus: (state) => {
    const t = state.typeahead;
    if (!t || t.status === 'idle') return '';
    if (t.status === 'loading') return 'loading';
    if (t.status === 'error') return 'error';
    const total = (t.data && t.data.facets)
      ? Object.values(t.data.facets).reduce((acc, n) => acc + (n || 0), 0)
      : 0;
    return `${total} match${total !== 1 ? 'es' : ''}`;
  },
};

export default UIbundle;
