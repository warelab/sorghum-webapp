import React, { useEffect, useState } from 'react'
import { getConfiguredCache } from 'money-clip'
import { expectedCount } from '../utils/typesense_counts'

const FIFTEEN_MIN = 1000 * 60 * 15

// Same shape and TTL as other wp_cache-backed lists so a recently-cached
// /abstracts visit primes /abstract/<slug> with no extra fetch.
const abstractsCache = getConfiguredCache({ maxAge: FIFTEEN_MIN, version: 1 })

const ABSTRACTS_URL = '/api/wp_cache/conference_abstracts'
const TYPESENSE_COLLECTION = 'abstracts'

function fetchAndCache() {
  return fetch(ABSTRACTS_URL, { headers: { Accept: 'application/json' } })
    .then((r) => {
      if (!r.ok) throw new Error(`abstracts ${r.status}`)
      return r.json()
    })
    .then((rows) => {
      if (rows && rows.length) abstractsCache.set('all', rows)
      return rows
    })
}

function loadAbstracts() {
  return abstractsCache.get('all').then((cached) => {
    if (!cached || !cached.length) return fetchAndCache()
    return expectedCount(TYPESENSE_COLLECTION).then((expected) => {
      if (expected !== null && expected !== cached.length) {
        return fetchAndCache()
      }
      return cached
    })
  })
}

function formatPresenter(p) {
  if (!p) return ''
  const last = (p.last_name || '').trim()
  const first = (p.first_name || '').trim()
  if (last && first) return `${first} ${last}`
  return last || first || ''
}

// Mirrors _normalize_orgs in controllers/abstracts.py: affiliations come in
// as plain strings, ready-shaped dicts, or stray integer IDs. Coerce them
// all to {post_title} so the renderer doesn't print "undefined".
function organizationsFor(presenter) {
  const raw = (presenter && (presenter.affiliation || presenter.organization)) || []
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => {
      if (typeof item === 'string') {
        const name = item.trim()
        return name ? { post_title: name } : null
      }
      if (item && typeof item === 'object' && typeof item.post_title === 'string') {
        return item.post_title.trim() ? item : null
      }
      return null
    })
    .filter(Boolean)
}

const AbstractDetail = ({ slug }) => {
  const [status, setStatus] = useState('loading')
  const [abstract, setAbstract] = useState(null)

  useEffect(() => {
    let cancelled = false
    loadAbstracts()
      .then((rows) => {
        if (cancelled) return
        const match = (rows || []).find((a) => a && a.slug === slug)
        if (!match) {
          setStatus('not_found')
          return
        }
        setAbstract(match)
        setStatus('ready')
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [slug])

  // Bump the H1 in the banner once we know the presentation type.
  useEffect(() => {
    if (status !== 'ready' || !abstract) return
    const h1 = document.getElementById('sb-abstract-heading')
    if (h1 && abstract.presentation_type) h1.textContent = abstract.presentation_type
  }, [status, abstract])

  if (status === 'loading') {
    return (
      <div className="container pb50">
        <div className="row justify-content-md-center">
          <div className="col-md-9 mb40" style={{ color: '#888' }}>Loading abstract…</div>
        </div>
      </div>
    )
  }

  if (status === 'not_found') {
    return (
      <div className="container pb50">
        <div className="row justify-content-md-center">
          <div className="col-md-9 mb40">
            <p>Abstract <code>{slug}</code> not found.</p>
            <p><a href="/abstracts">Back to all abstracts</a></p>
          </div>
        </div>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="container pb50">
        <div className="row justify-content-md-center">
          <div className="col-md-9 mb40">
            <p>Unable to load abstracts.</p>
            <p><a href="/abstracts">Back to all abstracts</a></p>
          </div>
        </div>
      </div>
    )
  }

  const title = (abstract.title && abstract.title.rendered) || ''
  const content = (abstract.content && abstract.content.rendered) || ''
  const presenter = (abstract.presenting_author || [])[0]
  const presenterName = formatPresenter(presenter)
  const orgs = organizationsFor(presenter)

  return (
    <div className="container pb50">
      <div className="row justify-content-md-center">
        <div className="col-md-9 mb40">
          <article>
            <div className="card mb10">
              <div className="card-header" role="tab">
                <h4 className="mb-0" dangerouslySetInnerHTML={{ __html: title }} />
                {(presenterName || orgs.length > 0) && (
                  <div className="mt10" style={{ color: '#555', fontSize: '0.95rem' }}>
                    {presenterName && <span><i className="fa fa-user-circle-o" /> {presenterName}</span>}
                    {orgs.length > 0 && (
                      <ul className="list-unstyled mb0" style={{ marginTop: 4 }}>
                        {orgs.map((o, i) => (
                          <li key={`${o.id || o.post_title || i}`}>{o.post_title}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
              <div className="card-body">
                <div dangerouslySetInnerHTML={{ __html: content }} />
              </div>
            </div>
            <p><a href="/abstracts">Back to all abstracts</a></p>
          </article>
        </div>
      </div>
    </div>
  )
}

export default AbstractDetail
