import React from 'react'
import { createRoot } from 'react-dom/client'
const render = (component, container) => {
  createRoot(container).render(component);
  return true;
};
import getStore from './bundles'
import cache from './utils/cache'
import ReactGA from 'react-ga4'
// import Summary from './components/summary'
// import Results from './components/results'
// import SearchBox from './components/searchbox'
import SearchBar from './components/searchbar'
import GeneSearchUI from './components/gramene-search-layout'
// import Feedback from './components/Feedback'
// import Institutions from './components/institutions'
import ConferencePage from './components/conference'
import WorkingGroups from './components/workingGroups'
import FundedProjects from './components/fundedProjects'
import Publications from './components/publications'
import HomeSection from './components/homePosts'
import PostsList from './components/postsList'
import EventsList from './components/eventsList'
import PeopleList from './components/peopleList'
import AbstractDetail from './components/abstractDetail'
import AbstractsList from './components/abstractsList'
import ProjectDetail from './components/projectDetail'
import PaperDetail from './components/paperDetail'
import PostDetail from './components/postDetail'
import GithubDocs from 'gramene-githubdocs'
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

// GithubDocs sizes its full-height layout to `100vh - offset`, where offset must
// be the height of the page chrome (navbar + banner) above the mount point.
// Measure it from the element's actual position so a long sidebar/body fits the
// viewport and scrolls internally instead of running off the bottom of the page.
const mdViewOffset = el => Math.ceil(el.getBoundingClientRect().top + window.scrollY);

const Notes = (offset) => (
  <GithubDocs
    org='warelab'
    repo='release-notes'
    path='sorghum'
    heading='Releases'
    sort='date'
    offset={offset}
  />
)
const Guides = (offset) => (
  <GithubDocs
    org='warelab'
    repo='release-notes'
    path='test'
    heading='Guides'
    sort='date'
    offset={offset}
  />
)
const Videos = (ids) => (
  <VideoGallery
    playlistIds={ids}
  />
)

// A cached async-resource entry whose payload is empty but which still carries a
// lastSuccess stamp is poison: redux-bundler treats it as fresh and won't
// refetch until staleAfter expires (24h for grameneMaps/grameneTaxonomy). That
// happens when an upstream or proxy hiccup answers with an empty body, and it
// leaves the genes page dead — "No genome found for {}", then a hard
// "Bin count mismatch!" out of gramene-bins-client. The fetches now reject empty
// payloads, but browsers that already stored one need to recover, so drop them
// here and let the bundle fetch again. Cost of a false positive is one extra
// request; cost of a false negative is a broken page.
function hasEmptyPayload(entry) {
  if (!entry || typeof entry !== 'object') return false;
  if (!Object.prototype.hasOwnProperty.call(entry, 'data')) return false;
  const d = entry.data;
  if (d === null || d === undefined) return true;
  if (Array.isArray(d)) return d.length === 0;
  if (typeof d === 'object') return Object.keys(d).length === 0;
  return false;
}

cache.getAll().then(initialData => {
  if (initialData) {
    Object.keys(initialData).forEach(key => {
      if (hasEmptyPayload(initialData[key])) {
        console.warn(`discarding empty cached "${key}" so it refetches`);
        delete initialData[key];
      }
    });
    if (initialData.hasOwnProperty('searchUI')) initialData.searchUI.suggestions_query="";
    console.log('starting with locally cached data:', initialData)
  }
  const store = getStore(initialData);

  const config = store.selectConfiguration();
  ReactGA.initialize(config.ga);
  if (initialData.hasOwnProperty('grameneMaps')) {
    // check for hidden genomes
    let notHidden = {};
    let haveHidden = false;
    Object.values(initialData.grameneMaps.data).forEach(m => {
      if (m.hidden) {
        haveHidden=true;
      }
      else {
        notHidden[m.taxon_id]=true;
      }
    })
    if (haveHidden) {
      store.doInitializeGrameneGenomes(notHidden)
    }
  }

  let element = document.getElementById('sorghumbase-searchbar');
  element && render(SearchBar(store), element) && console.log('rendered sorghumbase-searchbar');

  element = document.getElementById('gene-search-ui');
  element && render(GeneSearchUI(store), element) && console.log('rendered gene-search-ui');

  // element = document.getElementById('sorghumbase-feedback');
  // element && render(Feedback(), element) && console.log('rendered sorghumbase-feedback')
  //
  element = document.getElementById('sorghumbase-relnotes');
  element && render(Notes(mdViewOffset(element)), element) && console.log('rendered sorghumbase-relnotes')

  element = document.getElementById('sorghumbase-guides');
  element && render(Guides(mdViewOffset(element)), element) && console.log('rendered sorghumbase-guides')

  element = document.getElementById('sorghumbase-videos');
  element && config.playlistIds && render(Videos(config.playlistIds), element) && console.log('rendered sorghumbase-videos')

  // Generic Markdown-from-GitHub docs browser. The page supplies the repo and
  // location via data-* attributes; subdirectories become navigation levels.
  element = document.getElementById('sb-github-docs');
  if (element) {
    render(
      <GithubDocs
        org={element.getAttribute('data-org')}
        repo={element.getAttribute('data-repo')}
        path={element.getAttribute('data-path') || ''}
        branch={element.getAttribute('data-branch') || 'main'}
        heading={element.getAttribute('data-heading') || 'Documentation'}
        offset={mdViewOffset(element)}
      />,
      element
    ) && console.log('rendered sb-github-docs')
  }

  // element = document.getElementById('sorghumbase-institutions');
  // element && render(Institutions(store), element) && console.log('rendered sorghumbase-institutions')

  element = document.getElementById('sorghumbase-publications');
  element && render(Publications(store), element) && console.log('rendered sorghumbase-publications div')

  element = document.getElementById('sorghumbase-conference');
  element && render(ConferencePage(store), element) && console.log('rendered sorghumbase-conference div')

  element = document.getElementById('sorghumbase-working-groups');
  element && render(WorkingGroups(store), element) && console.log('rendered sorghumbase-working-groups')

  element = document.getElementById('sorghumbase-funded-projects');
  element && render(<FundedProjects />, element) && console.log('rendered sorghumbase-funded-projects')

  element = document.getElementById('sorghumbase-alerts');
  element && render(Alerter(), element) && console.log('rendered alerter')

  element = document.getElementById('sb-home-news');
  element && render(<HomeSection sectionKey="news" />, element) && console.log('rendered sb-home-news')

  element = document.getElementById('sb-home-highlights');
  element && render(<HomeSection sectionKey="highlights" />, element) && console.log('rendered sb-home-highlights')

  element = document.getElementById('sb-home-topics');
  element && render(<HomeSection sectionKey="topics" />, element) && console.log('rendered sb-home-topics')

  element = document.getElementById('sb-posts-list');
  element && render(<PostsList />, element) && console.log('rendered sb-posts-list')

  element = document.getElementById('sb-events-list');
  element && render(<EventsList />, element) && console.log('rendered sb-events-list')

  element = document.getElementById('sb-people-list');
  element && render(<PeopleList />, element) && console.log('rendered sb-people-list')

  element = document.getElementById('sb-abstract');
  if (element) {
    const slug = element.getAttribute('data-slug') || '';
    render(<AbstractDetail slug={slug} />, element) && console.log('rendered sb-abstract');
  }

  element = document.getElementById('sb-project');
  if (element) {
    const slug = element.getAttribute('data-slug') || '';
    render(<ProjectDetail slug={slug} />, element) && console.log('rendered sb-project');
  }

  element = document.getElementById('sb-paper');
  if (element) {
    const slug = element.getAttribute('data-slug') || '';
    render(<PaperDetail slug={slug} />, element) && console.log('rendered sb-paper');
  }

  element = document.getElementById('sb-post');
  if (element) {
    const slug = element.getAttribute('data-slug') || '';
    render(<PostDetail slug={slug} />, element) && console.log('rendered sb-post');
  }

  element = document.getElementById('sb-abstracts');
  if (element) {
    render(<AbstractsList />, element) && console.log('rendered sb-abstracts');
  }
})
