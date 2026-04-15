/**
 * Tracks incremental loading progress for publications.
 *
 * Actions:
 *   PUB_PROGRESS_SET  – set { loaded, total }
 *   PUB_PROGRESS_RESET – clear progress
 */
const INITIAL = { loaded: 0, total: 0 };

const publicationsProgress = {
  name: 'publicationsProgress',
  getReducer: () => (state = INITIAL, action) => {
    if (action.type === 'PUB_PROGRESS_SET') {
      return { loaded: action.loaded, total: action.total };
    }
    if (action.type === 'PUB_PROGRESS_RESET') {
      return INITIAL;
    }
    return state;
  },
  doSetPubProgress: (loaded, total) => ({ dispatch }) => {
    dispatch({ type: 'PUB_PROGRESS_SET', loaded, total });
  },
  doResetPubProgress: () => ({ dispatch }) => {
    dispatch({ type: 'PUB_PROGRESS_RESET' });
  },
  selectPubProgress: state => state.publicationsProgress,
};

export default publicationsProgress;
