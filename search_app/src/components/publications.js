import React from 'react';
import { Provider, connect } from 'redux-bundler-react'
import PublicationBrowser from './publicationBrowser'

const PublicationsListCmp = props => {
  if (props.sorghumPublications && props.sorghumTags) {
    return <PublicationBrowser
      publications={props.sorghumPublications}
      tagLabels={props.sorghumTags}
      pageSize={25}
      />
  }
  return <code>loading...</code>
}

const PublicationsList = connect(
  'selectSorghumPublications',
  'selectSorghumTags',
  PublicationsListCmp
)

const Publications = (store) => {
  return (
    <Provider store={store}>
      <PublicationsList/>
    </Provider>
  )
};

export default Publications;
