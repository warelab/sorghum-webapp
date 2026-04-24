import React from 'react'
import { Provider, connect } from 'redux-bundler-react'
import { Status, Filters, Results, Views, Auth } from 'gramene-search'
import HelpDemo from './HelpDemo'

const ResultsOrHelpCmp = props => {
  const views = (props.grameneViews && props.grameneViews.options) || [];
  const anyViewOn = views.some(v => v.id !== 'help' && v.show === 'on');
  return (props.grameneFilters.rightIdx > 1 || anyViewOn) ? <Results/> : <HelpDemo/>;
}

const ResultsOrHelp = connect(
    'selectGrameneFilters',
    'selectGrameneViews',
    ResultsOrHelpCmp
)

const GrameneSearchLayout = (store) => (
  <Provider store={store}>
    <div className="no-margin no-padding search-views-layout">
      <div className="sorghumbase-sidebar">
        <Status/>
        <Filters/>
        <Views/>
        <Auth/>
      </div>
      <div className="search-views-content">
        <Results/>
      </div>
    </div>
  </Provider>
);

export default GrameneSearchLayout;
