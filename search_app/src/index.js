import React from 'react'
import { render } from 'react-dom'
import getStore from './bundles'
import cache from './utils/cache'
import ReactGA from 'react-ga4'
// import Summary from './components/summary'
// import Results from './components/results'
// import SearchBox from './components/searchbox'
import SearchBar from './components/searchbar'
import GeneSearchUI from './components/gramene-search-layout'
import Feedback from './components/Feedback'
// import Institutions from './components/institutions'
import ConferencePage from './components/conference'
import WorkingGroups from './components/workingGroups'
import FundedProjects from './components/fundedProjects'
import MDView from "gramene-mdview";
import Alerts from 'gramene-alerts';
import VideoGallery from 'gramene-videos';
import "../css/style.css"

const Alerter = () => (
  <div className={"col-md-12 no-padding"}>
    <Alerts
      org='warelab'
      repo='release-notes'
      path='alerts'
      site='sorghum'
    />
  </div>
);

const Notes = () => (
  <MDView
    org='warelab'
    repo='release-notes'
    path='sorghum'
    heading='Releases'
    date='2025-01-07'
    offset={200}
  />

)
const Guides = () => (
    <MDView
        org='warelab'
        repo='release-notes'
        path='test'
        heading='Guides'
        date='2025-01-01'
        offset={200}
    />
)
const Videos = (ids) => (
  <VideoGallery
    playlistIds={ids}
  />
)

cache.getAll().then(initialData => {
  if (initialData) {
    if (initialData.hasOwnProperty('searchUI')) initialData.searchUI.suggestions_query="";
    console.log('starting with locally cached data:', initialData)
  }
  const store = getStore(initialData);

  const config = store.selectConfiguration();
  ReactGA.initialize(config.ga);

  let element = document.getElementById('sorghumbase-searchbar');
  element && render(SearchBar(store), element) && console.log('rendered sorghumbase-searchbar');

  element = document.getElementById('gene-search-ui');
  element && render(GeneSearchUI(store), element) && console.log('rendered gene-search-ui');

  element = document.getElementById('sorghumbase-feedback');
  element && render(Feedback(), element) && console.log('rendered sorghumbase-feedback')

  element = document.getElementById('sorghumbase-relnotes');
  element && render(Notes(), element) && console.log('rendered sorghumbase-relnotes')

  element = document.getElementById('sorghumbase-guides');
  element && render(Guides(), element) && console.log('rendered sorghumbase-guides')

  element = document.getElementById('sorghumbase-videos');
  element && config.playlistIds && render(Videos(config.playlistIds), element) && console.log('rendered sorghumbase-videos')

  // element = document.getElementById('sorghumbase-institutions');
  // element && render(Institutions(store), element) && console.log('rendered sorghumbase-institutions')

  element = document.getElementById('sorghumbase-conference');
  element && render(ConferencePage(store), element) && console.log('rendered sorghumbase-conference div')

  element = document.getElementById('sorghumbase-working-groups');
  element && render(WorkingGroups(store), element) && console.log('rendered sorghumbase-working-groups')

  element = document.getElementById('sorghumbase-funded-projects');
  element && render(FundedProjects(store), element) && console.log('rendered sorghumbase-funded-projects')

  element = document.getElementById('sorghumbase-alerts');
  element && render(Alerter(), element) && console.log('rendered alerter')
})
