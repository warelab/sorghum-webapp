import { createAsyncResourceBundle, createSelector } from 'redux-bundler'
import _ from 'lodash'

const sorghumConference = createAsyncResourceBundle({
  name: 'sorghumConference',
  actionBaseType: 'SORGHUM_CONFERENCE',
  persist: true,
  getPromise: ({store}) => {
    return fetch(`https://content.sorghumbase.org/wordpress/index.php/wp-json/wp/v2/conference`)
      .then(res => res.json())
      .then(conferences => _.keyBy(conferences, 'slug'))
  }
});
sorghumConference.reactSorghumConference = createSelector(
  'selectSorghumConferenceShouldUpdate',
  (shouldUpdate) => {
    if (shouldUpdate) {
      return { actionCreator: 'doFetchSorghumConference' }
    }
  }
);

const sorghumDocs = {
  name: 'sorghumDocs',
  getReducer: () => {
    const initialState = {
      media: {}
    };
    const initializeMediaToState = (state, payload) => {
      let newStateMedia = {...state.media};
      payload.forEach(id => {
        if (!state.media.hasOwnProperty(id)) newStateMedia[id] = {};
      })
      return newStateMedia;
    }
    const assignMediaToState = (state, mediaItems) => {
      let newStateMedia = {...state.media};
      mediaItems.forEach(mediaItem => {
        newStateMedia[mediaItem.id] = mediaItem;
      });
      return newStateMedia;
    };

    const reducer = (state = initialState, {type, payload}) => {
      switch (type) {
        case 'SORGHUM_MEDIA_REQUESTED':
          return {
            ...state,
            media: initializeMediaToState(state, payload)
          };
        case 'SORGHUM_MEDIA_RECEIVED':
          return {
            ...state,
            media: assignMediaToState(state, payload)
          };
        default:
          return state;
      }
    }
    return reducer;
  },
  doRequestMedia: ids => ({dispatch, store}) => {
    const media = store.selectSorghumMedia();
    const idsToFetch = ids.filter(id => !media.hasOwnProperty(id));
    if (idsToFetch) {
      // dispatch({ type: 'SORGHUM_MEDIA_REQUESTED', payload: idsToFetch })
      return fetch(`https://content.sorghumbase.org/wordpress/index.php/wp-json/wp/v2/media?include=${idsToFetch.join(',')}`)
        .then(res => res.json())
        .then(media => {
          dispatch({ type: 'SORGHUM_MEDIA_RECEIVED', payload: media });
        });
    }
  },
  selectSorghumMedia: state => state.sorghumDocs.media
}
export default [sorghumConference,sorghumDocs];