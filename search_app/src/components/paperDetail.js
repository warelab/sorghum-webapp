import React, { useEffect, useState } from 'react'
import { loadPublications } from '../utils/publications_cache'
import { slugsMatch } from '../utils/slug'

// `slug` may be a real WP slug ("foo-bar-baz") OR a numeric post ID. Project
// detail pages link with the ID because the project_publications records
// don't carry a usable slug field.
function findPaper(rows, slug) {
  if (!rows) return null
  const direct = rows.find((p) => p && slugsMatch(p.slug, slug))
  if (direct) return direct
  if (/^\d+$/.test(slug)) {
    const idNum = Number(slug)
    return rows.find((p) => p && (p.id === idNum || String(p.id) === slug)) || null
  }
  return null
}

function formatPubDate(raw) {
  if (!raw) return ''
  // publication_date is YYYY-MM-DD in the cache.
  const d = new Date(raw)
  if (isNaN(d)) return raw
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

const Card = ({ heading, children }) => (
  <div className="card mb10">
    <div className="card-header" role="tab">
      <h5 className="mb-0">{heading}</h5>
    </div>
    <div className="card-body">{children}</div>
  </div>
)

const PaperDetail = ({ slug }) => {
  const [status, setStatus] = useState('loading')
  const [paper, setPaper] = useState(null)

  useEffect(() => {
    let cancelled = false
    loadPublications()
      .then((rows) => {
        if (cancelled) return
        const match = findPaper(rows, slug)
        if (!match) {
          setStatus('not_found')
          return
        }
        setPaper(match)
        setStatus('ready')
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [slug])

  // Set the document title once we have the paper, since the Flask shell
  // can't (it has no access to the title).
  useEffect(() => {
    if (status === 'ready' && paper) {
      const t = (paper.title && paper.title.rendered) || paper.title || ''
      if (t) document.title = `Publication - ${t.replace(/<[^>]+>/g, '')}`
    }
  }, [status, paper])

  if (status === 'loading') {
    return (
      <div className="container pt90"><p style={{ color: '#888' }}>Loading publication…</p></div>
    )
  }
  if (status === 'not_found') {
    return (
      <div className="container pt90">
        <p>Publication <code>{slug}</code> not found.</p>
        <p><a href="/publications">Back to all publications</a></p>
      </div>
    )
  }
  if (status === 'error') {
    return (
      <div className="container pt90">
        <p>Unable to load publications.</p>
        <p><a href="/publications">Back to all publications</a></p>
      </div>
    )
  }

  const title = (paper.title && paper.title.rendered) || paper.title || ''
  const pubDate = formatPubDate(paper.publication_date)
  const funders = Array.isArray(paper.funding) ? paper.funding : []
  const sortedFunders = [...funders].sort((a, b) => {
    const k = (x) => `${x.agency || ''}|${x.program || ''}|${x.grant_id || ''}`
    return k(a).localeCompare(k(b))
  })
  const relatedPosts = Array.isArray(paper.posts) ? paper.posts : []

  return (
    <div className="container pt90">
      <div id="grid" className="row my-shuffle-container">
        <div className="col-lg-12 col-md-6 mb50">
          <h4 className="mb0" dangerouslySetInnerHTML={{ __html: title }} />
          {paper.paper_authors && (
            <p><em dangerouslySetInnerHTML={{ __html: paper.paper_authors }} /></p>
          )}
          {pubDate && (
            <h6>
              <b>Published: </b>{pubDate}
              {paper.journal && <> in <em>{paper.journal}</em></>}
            </h6>
          )}
          {paper.keywords && <h6><b>Keywords: </b>{paper.keywords}</h6>}
          {paper.pubmed_id && (
            <h6>
              <b>Pubmed ID: </b>
              <a style={{ color: '#9F3D34' }} target="_blank" rel="noreferrer"
                 href={`https://pubmed.ncbi.nlm.nih.gov/${paper.pubmed_id}`}>
                {paper.pubmed_id}
              </a>
            </h6>
          )}
          {paper.doi ? (
            <h6>
              <b>DOI: </b>
              <a style={{ color: '#9F3D34' }} target="_blank" rel="noreferrer"
                 href={`https://doi.org/${paper.doi}`}>
                {paper.doi}
              </a>
            </h6>
          ) : paper.source_url ? (
            <a style={{ color: '#9F3D34' }} href={paper.source_url}>
              <h6 className="masonry-title mb1">View full paper at source</h6>
            </a>
          ) : null}

          {paper.abstract && (
            <Card heading="Abstract">
              <p dangerouslySetInnerHTML={{ __html: paper.abstract }} />
            </Card>
          )}

          {relatedPosts.length > 0 && (
            <Card heading="Related Posts">
              {relatedPosts.map((post, i) => {
                const text = typeof post === 'string' ? post : (post.post_title || post.title || '')
                const target = typeof post === 'string'
                  ? post.replace(/ /g, '-')
                  : (post.slug || (post.post_title || '').replace(/ /g, '-'))
                return (
                  <h6 key={i} className="masonry-title mb1">
                    <a style={{ color: '#9F3D34' }} href={`/post/${target}`}>{text}</a>
                  </h6>
                )
              })}
            </Card>
          )}

          {sortedFunders.length > 0 && (
            <Card heading="Funding">
              {sortedFunders.map((f, i) => (
                <h6 key={i} className="masonry-title mb1">
                  {f.agency}
                  {f.program && ` - ${f.program}`}
                  {' '}
                  {f.link
                    ? <a style={{ color: '#9F3D34' }} href={f.link}>{f.grant_id}</a>
                    : f.grant_id}
                </h6>
              ))}
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

export default PaperDetail
