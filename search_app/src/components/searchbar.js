import { useEffect, useRef } from 'react'
import { Provider, connect } from 'redux-bundler-react'
import { DebounceInput } from 'react-debounce-input'
import { Nav, Tab, Row, Col } from 'react-bootstrap'
import {suggestions as GrameneSummary} from 'gramene-search'
import Typeahead from './typeahead'

const handleKey = (e, props) => {
  if (e.key === "Escape") {
    props.doClearSuggestions();
  }
  if (e.key === "Tab") {
    if (props.suggestionsTab === "gramene" && props.grameneSuggestionsReady) {
      e.preventDefault();
      document.getElementById('0-0').focus();
    }
  }
};

const SearchBarCmp = props => {
  const prevNonEmpty = useRef(false);

  useEffect(() => {
    const isNonEmpty = !!(props.suggestionsQuery && props.suggestionsQuery.trim().length > 0);

    if (!prevNonEmpty.current && isNonEmpty) {
      const el = document.getElementById('sorghumbase-searchbar-parent');
      if (el && !el.classList.contains('search-visible')) {
        el.classList.add('search-visible');
      }
    }

    prevNonEmpty.current = isNonEmpty;
  }, [props.suggestionsQuery]);

  return <DebounceInput
    minLength={0}
    debounceTimeout={300}
    onChange={e => props.doChangeSuggestionsQuery(e.target.value)}
    onKeyDown={e => handleKey(e, props)}
    className="form-control"
    value={props.suggestionsQuery || ''}
    placeholder="Search posts, papers, abstracts, projects, events, links…"
    id="sorghumbase-search-input"
    autoComplete="off"
    spellCheck="false"
  />;
};

const SearchBar = connect(
  'selectSuggestionsQuery',
  'selectSuggestionsTab',
  'doChangeSuggestionsQuery',
  'doClearSuggestions',
  'selectGrameneSuggestionsReady',
  SearchBarCmp
);

const ResultsCmp = props => {
  if (!props.suggestionsQuery) return null;

  const spinner = <img src="/static/images/dna_spinner.svg"/>;
  const genesStatus = props.grameneSuggestionsStatus === 'loading' ? spinner : props.grameneSuggestionsStatus;
  const siteStatus  = props.sorghumSuggestionsStatus === 'loading' ? spinner : props.sorghumSuggestionsStatus;

  return (
    <div className="search-suggestions">
      <Tab.Container
        id="controlled-search-tabs"
        activeKey={props.suggestionsTab}
        onSelect={k => props.doChangeSuggestionsTab(k)}
      >
        <Row>
          <Col>
            <Nav variant="tabs">
              <Nav.Item>
                <Nav.Link eventKey="gramene">
                  <div className="suggestions-tab">Genes {genesStatus}</div>
                </Nav.Link>
              </Nav.Item>
              <Nav.Item>
                <Nav.Link eventKey="sorghumbase">
                  <div className="suggestions-tab">Website {siteStatus}</div>
                </Nav.Link>
              </Nav.Item>
            </Nav>
          </Col>
        </Row>
        <Row>
          <Col>
            <Tab.Content>
              <Tab.Pane eventKey="gramene">
                <GrameneSummary/>
              </Tab.Pane>
              <Tab.Pane eventKey="sorghumbase">
                <Typeahead/>
              </Tab.Pane>
            </Tab.Content>
          </Col>
        </Row>
      </Tab.Container>
    </div>
  );
};

const Results = connect(
  'selectSuggestionsQuery',
  'selectSuggestionsTab',
  'selectGrameneSuggestionsStatus',
  'selectSorghumSuggestionsStatus',
  'doChangeSuggestionsTab',
  ResultsCmp
);

const Searcher = (store) => (
  <Provider store={store}>
    <div>
      <SearchBar/>
      <Results/>
    </div>
  </Provider>
);

export default Searcher;
