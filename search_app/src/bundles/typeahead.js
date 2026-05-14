// Typeahead bundle: fetches /api/typeahead whenever the navbar search input
// changes. Replaces the old sorghum-search npm bundles which proxied the WP
// REST API per-category. Backend now answers in one shot from Typesense.

const initialState = {
  query: '',
  lastQuery: '',
  status: 'idle',
  data: null,
  error: null,
};

const typeaheadBundle = {
  name: 'typeahead',

  getReducer: () => (state = initialState, { type, payload }) => {
    switch (type) {
      case 'TYPEAHEAD_FETCH_STARTED':
        return { ...state, status: 'loading', query: payload, error: null };
      case 'TYPEAHEAD_FETCH_SUCCEEDED':
        return {
          ...state,
          status: 'ready',
          data: payload.data,
          lastQuery: payload.query,
          error: null,
        };
      case 'TYPEAHEAD_FETCH_FAILED':
        return { ...state, status: 'error', error: payload };
      case 'TYPEAHEAD_CLEARED':
      case 'SUGGESTIONS_CLEARED':
        return { ...initialState };
      default:
        return state;
    }
  },

  doFetchTypeahead: (q) => async ({ dispatch }) => {
    const trimmed = (q || '').trim();
    if (!trimmed) {
      dispatch({ type: 'TYPEAHEAD_CLEARED' });
      return;
    }
    dispatch({ type: 'TYPEAHEAD_FETCH_STARTED', payload: trimmed });
    try {
      const res = await fetch(`/api/typeahead?q=${encodeURIComponent(trimmed)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      // Guard against out-of-order responses overwriting newer state.
      dispatch({ type: 'TYPEAHEAD_FETCH_SUCCEEDED', payload: { data, query: trimmed } });
    } catch (e) {
      dispatch({ type: 'TYPEAHEAD_FETCH_FAILED', payload: e.message || String(e) });
    }
  },

  doClearTypeahead: () => ({ dispatch }) => dispatch({ type: 'TYPEAHEAD_CLEARED' }),

  selectTypeahead: (state) => state.typeahead,
  selectTypeaheadStatus: (state) => state.typeahead.status,
  selectTypeaheadData: (state) => state.typeahead.data,
  selectTypeaheadFacets: (state) => (state.typeahead.data && state.typeahead.data.facets) || {},
  selectTypeaheadTotal: (state) => {
    const facets = (state.typeahead.data && state.typeahead.data.facets) || {};
    return Object.values(facets).reduce((acc, n) => acc + (n || 0), 0);
  },

  reactTypeaheadFetch: (state) => {
    const q = (state.searchUI && state.searchUI.suggestions_query) || '';
    const trimmed = q.trim();
    const t = state.typeahead;
    if (!trimmed) {
      if (t.status !== 'idle') return { actionCreator: 'doClearTypeahead' };
      return;
    }
    if (t.status === 'loading' && t.query === trimmed) return;
    if (t.status === 'ready' && t.lastQuery === trimmed) return;
    if (t.status === 'error' && t.query === trimmed) return;
    return { actionCreator: 'doFetchTypeahead', args: [trimmed] };
  },
};

export default typeaheadBundle;
