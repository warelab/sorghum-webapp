import React, { useEffect, useMemo, useState } from 'react'
import { getConfiguredCache } from 'money-clip'
import { expectedTimestamp, timestampFromResponse } from '../utils/wp_cache_timestamps'
import Pagination from './pagination'

// Posts listing is now powered by Typesense via /api/posts/search:
// - one request per page, returning hit summaries (title/excerpt/url/date)
// - supports ?q= for full-text search and ?categories=<slug,slug> filtering
// - sorts by relevance when q is set, by date desc otherwise
//
// We still need a category slug -> id lookup so that human-friendly slugs in
// the URL (e.g. categories=news) can be translated into the numeric IDs that
// the posts collection is indexed against. The list lives in wp_cache
// (`post_categories` resource); we mirror it into money-clip for cross-page
// reuse, with a timestamp-based freshness check.

const categoriesCache = getConfiguredCache({ maxAge: Infinity, version: 3, name: 'postCategories' })

const CATEGORIES_URL = '/api/wp_cache/post_categories'
const CATEGORIES_RESOURCE = 'post_categories'
const PER_PAGE = 30

function readQuery() {
  const params = new URLSearchParams(window.location.search)
  const rawCats = params.get('categories')
  const categories = rawCats
    ? rawCats.split(',').map((s) => s.trim()).filter(Boolean)
    : []
  const page = parseInt(params.get('page'), 10) || 1
  const q = (params.get('q') || '').trim()
  return { categories, page, q }
}

function categoryHeading(categories) {
  if (!categories.length) return 'posts'
  if (categories[0] === 'researchnote') return 'Research notes'
  if (categories[0] === 'topics') return 'Special Topics'
  return categories.join(' & ')
}

function bannerUrl(categories) {
  if (categories.includes('blog')) {
    return 'https://content.sorghumbase.org/wordpress/wp-content/uploads/2018/05/sorghum_combine.jpg'
  }
  return 'https://content.sorghumbase.org/wordpress/wp-content/uploads/2018/05/k-state-sorghum-field-1920x1000.jpg'
}

function fetchAndCacheCategories() {
  return fetch(CATEGORIES_URL, { headers: { Accept: 'application/json' } })
    .then((r) => {
      if (!r.ok) throw new Error(`categories ${r.status}`)
      const ts = timestampFromResponse(r)
      return r.json().then((rows) => {
        if (rows && rows.length) categoriesCache.set('all', { data: rows, fetched_at: ts })
        return rows
      })
    })
}

function _unwrap(cached) {
  if (!cached) return null
  if (Array.isArray(cached)) {
    return cached.length ? { data: cached, fetched_at: 0 } : null
  }
  if (cached.data && Array.isArray(cached.data) && cached.data.length) {
    return { data: cached.data, fetched_at: cached.fetched_at || 0 }
  }
  return null
}

function loadAllCategories() {
  return categoriesCache.get('all').then((cached) => {
    const local = _unwrap(cached)
    if (!local) return fetchAndCacheCategories()
    return expectedTimestamp(CATEGORIES_RESOURCE).then((serverTs) => {
      if (serverTs !== null && serverTs > local.fetched_at) {
        return fetchAndCacheCategories()
      }
      return local.data
    })
  })
}

function lookupCategoryIds(slugs) {
  if (!slugs.length) return Promise.resolve([])
  return loadAllCategories().then((cats) => {
    const wanted = new Set(slugs)
    return (cats || [])
      .filter((c) => c && wanted.has(c.slug))
      .map((c) => c.id)
  })
}

function fetchPostsPage({ categoryIds, page, q }) {
  const params = new URLSearchParams()
  params.set('page', String(page))
  params.set('per_page', String(PER_PAGE))
  if (q) params.set('q', q)
  if (categoryIds.length) params.set('categories', categoryIds.join(','))
  return fetch(`/api/posts/search?${params.toString()}`, {
    headers: { Accept: 'application/json' },
  }).then((r) => {
    if (!r.ok) throw new Error(`posts/search ${r.status}`)
    return r.json()
  })
}

function formatDate(epochOrIso) {
  if (!epochOrIso) return ''
  const d = typeof epochOrIso === 'number'
    ? new Date(epochOrIso * 1000)
    : new Date(epochOrIso)
  if (isNaN(d)) return ''
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

function pageHref({ categories, page, q }) {
  const params = new URLSearchParams()
  if (categories.length) params.set('categories', categories.join(','))
  if (page > 1) params.set('page', String(page))
  if (q) params.set('q', q)
  const qs = params.toString()
  return qs ? `${window.location.pathname}?${qs}` : window.location.pathname
}

const PostCard = ({ hit }) => {
  const title = hit.title_highlight || hit.title
  const excerpt = hit.excerpt_highlight || hit.excerpt
  const date = formatDate(hit.date)
  return (
    <div className="col-lg-4 col-md-6 mb30">
      <div className="entry-card">
        <div className="entry-content">
          <h5 className="text-capitalize">
            <a href={hit.url} dangerouslySetInnerHTML={{ __html: title }} />
          </h5>
          <ul className="post-meta list-inline" style={{ fontSize: 'smaller' }}>
            {date && (
              <li className="list-inline-item">
                <i className="fa fa-calendar-o"></i> {date}
              </li>
            )}
          </ul>
          {excerpt && <p dangerouslySetInnerHTML={{ __html: excerpt }} />}
          <div className="text-right">
            <a href={hit.url} className="btn-link btn">Read More</a>
          </div>
        </div>
      </div>
    </div>
  )
}

const PostsList = () => {
  const [query, setQuery] = useState(readQuery)
  const [state, setState] = useState({ hits: null, totalPages: 1, found: 0, error: null })

  const catsKey = useMemo(() => query.categories.join(','), [query.categories])

  useEffect(() => {
    const onPop = () => setQuery(readQuery())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  useEffect(() => {
    let cancelled = false
    setState((s) => ({ ...s, hits: null, error: null }))
    lookupCategoryIds(query.categories)
      .then((categoryIds) => fetchPostsPage({ categoryIds, page: query.page, q: query.q }))
      .then((res) => {
        if (cancelled) return
        setState({
          hits: res.hits || [],
          totalPages: res.total_pages || 1,
          found: res.found || 0,
          error: null,
        })
      })
      .catch((e) => {
        if (cancelled) return
        setState({ hits: [], totalPages: 1, found: 0, error: e })
      })
    return () => {
      cancelled = true
    }
  }, [catsKey, query.page, query.q])

  const navigate = (page) => {
    const next = { ...query, page }
    window.history.pushState({}, '', pageHref(next))
    setQuery(next)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const heading = categoryHeading(query.categories)
  const banner = bannerUrl(query.categories)

  return (
    <>
      <div
        className="page-titles-img title-space-md bg-parallax parallax-overlay"
        data-jarallax='{"speed": 0.2}'
        style={{ backgroundImage: `url("${banner}")` }}
      >
        <div className="container">
          <div className="row">
            <div className="col-md-8 ml-auto mr-auto">
              <h1 className="text-uppercase">{heading}</h1>
            </div>
          </div>
        </div>
      </div>
      <div className="container pt90">
        <div className="container mb30">
          {query.q && (
            <p className="mb20" style={{ color: '#666' }}>
              {state.found} post{state.found === 1 ? '' : 's'} matching <strong>{query.q}</strong>.{' '}
              <a href={pageHref({ categories: query.categories, page: 1, q: '' })}>
                Clear search
              </a>
            </p>
          )}
          <div className="row">
            {state.error && <div className="col-lg-12">Unable to load posts.</div>}
            {!state.error && !state.hits && <div className="col-lg-12">&nbsp;</div>}
            {state.hits && state.hits.length === 0 && (
              <div className="col-lg-12">No matching posts.</div>
            )}
            {state.hits && state.hits.map((h) => <PostCard hit={h} key={h.id} />)}
          </div>
          <Pagination
            page={query.page}
            totalPages={state.totalPages}
            onNavigate={navigate}
            buildHref={(p) => pageHref({ ...query, page: p })}
            className="mb70"
          />
        </div>
      </div>
    </>
  )
}

export default PostsList
