import React from 'react'
import { Provider, connect } from 'redux-bundler-react'
import { Status, Filters, Results, Views } from 'gramene-search'
import HelpDemo from './HelpDemo'

const ResultsOrHelpCmp = props => {
  return props.grameneFilters.rightIdx > 1 ? <Results/> : <HelpDemo/>;
}

const ResultsOrHelp = connect(
    'selectGrameneFilters',
    ResultsOrHelpCmp
)

const GrameneSearchLayout = (store) => (
  <Provider store={store}>
    <div className="no-margin no-padding search-views-layout">
      <div className="sorghumbase-sidebar">
        <Status/>
        <Filters/>
        {/*<Views/>*/}
      </div>
      <div className="search-views-content">
        <ResultsOrHelp/>
      </div>
    </div>
  </Provider>
);

export default GrameneSearchLayout;
