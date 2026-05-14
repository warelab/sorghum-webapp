import ReactGA from 'react-ga4'

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
    };
    return (state = initialState, { type, payload }) => {
      if (type === 'SUGGESTIONS_QUERY_CHANGED') {
        return { ...state, suggestions_query: payload.query };
      }
      if (type === 'SUGGESTIONS_TAB_CHANGED') {
        return { ...state, suggestions_tab: payload.key };
      }
      if (type === 'SUGGESTIONS_CLEARED') {
        return { ...state, suggestions_query: '' };
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
