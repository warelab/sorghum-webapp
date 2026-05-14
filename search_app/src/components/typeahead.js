import { connect } from 'redux-bundler-react'

const CATEGORY_LABELS = {
  posts: 'News & Blog',
  papers: 'Publications',
  projects: 'Projects',
  abstracts: 'Conference Abstracts',
  resource_links: 'Resource Links',
};

// "show all" link target per category. Each listing page is expected to read
// the `q` query param and filter accordingly; routes that don't yet honor it
// are tracked separately.
const CATEGORY_LISTING = {
  posts: '/posts',
  papers: '/publications',
  projects: '/projects',
  abstracts: '/abstracts',
  resource_links: '/resource_links',
};

// Preserves the order in which categories appear in the dropdown.
const CATEGORY_ORDER = [
  'posts', 'papers', 'abstracts', 'projects', 'resource_links',
];

const renderSnippet = (highlight, fallback) => {
  if (highlight) {
    return <span dangerouslySetInnerHTML={{ __html: highlight }} />;
  }
  return <span>{fallback}</span>;
};

const DATE_FMT = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short' });
const formatDate = (epoch) => {
  if (!epoch) return null;
  try {
    return DATE_FMT.format(new Date(epoch * 1000));
  } catch (_) {
    return null;
  }
};

const TypeaheadCmp = ({ typeahead }) => {
  const { status, data, error } = typeahead;

  if (status === 'idle') return null;
  if (status === 'loading' && !data) {
    return <div className="typeahead-empty">Searching…</div>;
  }
  if (status === 'error') {
    return <div className="typeahead-empty">Search unavailable ({error || 'error'}).</div>;
  }
  if (!data || !data.groups || !data.groups.length) {
    return <div className="typeahead-empty">No matches.</div>;
  }

  const groupsByCat = {};
  data.groups.forEach(g => { groupsByCat[g.category] = g; });

  const ordered = CATEGORY_ORDER
    .map(cat => groupsByCat[cat])
    .filter(g => g && g.hits && g.hits.length);

  if (!ordered.length) {
    return <div className="typeahead-empty">No matches.</div>;
  }

  const query = (data && data.q) || '';

  return (
    <div className="typeahead-results">
      {ordered.map(group => {
        const listing = CATEGORY_LISTING[group.category];
        const showAllUrl = listing && query
          ? `${listing}?q=${encodeURIComponent(query)}`
          : null;
        return (
        <div key={group.category} className="typeahead-group">
          <div className="typeahead-group-header">
            <span className="typeahead-group-label">
              {CATEGORY_LABELS[group.category] || group.category}
            </span>
            {showAllUrl ? (
              <a className="typeahead-group-showall" href={showAllUrl}>
                {group.found} <span className="typeahead-group-showall-label">show all</span>
              </a>
            ) : (
              <span className="typeahead-group-count">{group.found}</span>
            )}
          </div>
          <ul className="typeahead-hit-list">
            {group.hits.map(hit => {
              const dateStr = formatDate(hit.date);
              const hasCitation = hit.authors || hit.journal;
              return (
                <li key={`${hit.category}-${hit.id}`} className="typeahead-hit">
                  <a href={hit.url}>
                    <div className="typeahead-hit-title">
                      {renderSnippet(hit.title_highlight, hit.title)}
                    </div>
                    {hasCitation && (
                      <div className="typeahead-hit-citation">
                        {hit.authors && (
                          <span className="typeahead-hit-authors">
                            {renderSnippet(hit.authors_highlight, hit.authors)}
                          </span>
                        )}
                        {hit.journal && (
                          <span className="typeahead-hit-journal">
                            <em>{renderSnippet(hit.journal_highlight, hit.journal)}</em>
                          </span>
                        )}
                      </div>
                    )}
                    {(hit.excerpt || dateStr) && (
                      <div className="typeahead-hit-meta">
                        {dateStr && <span className="typeahead-hit-date">{dateStr}</span>}
                        {hit.excerpt && !hasCitation && (
                          <span className="typeahead-hit-excerpt">
                            {renderSnippet(hit.excerpt_highlight, hit.excerpt)}
                          </span>
                        )}
                      </div>
                    )}
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
        );
      })}
    </div>
  );
};

export default connect('selectTypeahead', TypeaheadCmp);
