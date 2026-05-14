import React, { useEffect, useMemo, useState } from 'react'
import { getConfiguredCache } from 'money-clip'

const WP_BASE =
  'https://content.sorghumbase.org/wordpress/index.php/wp-json/wp/v2'

const FIFTEEN_MIN = 1000 * 60 * 15
const ONE_DAY = 1000 * 60 * 60 * 24

// Per-page post lists (short TTL: posts change).
const postsCache = getConfiguredCache({ maxAge: FIFTEEN_MIN, version: 1 })

// Category slug -> id lookups (longer TTL: terms are stable).
const categoryCache = getConfiguredCache({ maxAge: ONE_DAY, version: 1 })

// Category IDs we always want to filter out (mirrors the previous Flask logic).
// 8 = "faq", 17 = "Sorghumbase CMS Tutorials".
const EXCLUDE_IDS = [8, 17]

const DEFAULT_PER_PAGE = 9

function readQuery() {
  const params = new URLSearchParams(window.location.search)
  const rawCats = params.get('categories')
  const categories = rawCats
    ? rawCats.split(',').map((s) => s.trim()).filter(Boolean)
    : []
  const page = parseInt(params.get('page'), 10) || 1
  const perPage = parseInt(params.get('show'), 10) || DEFAULT_PER_PAGE
  const q = (params.get('q') || '').trim()
  return { categories, page, perPage, q }
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

function lookupCategoryIds(slugs) {
  if (!slugs.length) return Promise.resolve([])
  const key = `slugs:${slugs.slice().sort().join(',')}`
  return categoryCache.get(key).then((cached) => {
    if (cached) return cached
    const url = `${WP_BASE}/categories?slug=${slugs.join(',')}&per_page=50`
    return fetch(url, { headers: { Accept: 'application/json' } })
      .then((r) => {
        if (!r.ok) throw new Error(`categories ${r.status}`)
        return r.json()
      })
      .then((rows) => {
        const ids = rows.map((c) => c.id)
        categoryCache.set(key, ids)
        return ids
      })
  })
}

function buildPostsUrl({ categoryIds, page, perPage, q }) {
  const params = new URLSearchParams()
  if (categoryIds.length) params.set('categories', categoryIds.join(','))
  params.set('categories_exclude', EXCLUDE_IDS.join(','))
  // WP's `search` orders by relevance internally, so only force date order
  // when there is no query.
  if (!q) {
    params.set('orderby', 'date')
    params.set('order', 'desc')
  }
  params.set('per_page', String(perPage))
  params.set('page', String(page))
  params.set('_embed', 'wp:featuredmedia,author')
  if (q) params.set('search', q)
  return `${WP_BASE}/posts?${params.toString()}`
}

function fetchPostsPage({ categoryIds, page, perPage, q }) {
  const cacheKey = `posts:${categoryIds.join(',')}|p=${page}|n=${perPage}|q=${q || ''}`
  return postsCache.get(cacheKey).then((cached) => {
    if (cached) return cached
    const url = buildPostsUrl({ categoryIds, page, perPage })
    return fetch(url, { headers: { Accept: 'application/json' } }).then((r) => {
      if (!r.ok) throw new Error(`posts ${r.status}`)
      const total = parseInt(r.headers.get('X-WP-Total') || '0', 10)
      const totalPages = parseInt(r.headers.get('X-WP-TotalPages') || '1', 10)
      return r.json().then((rows) => {
        const value = { posts: rows.map(normalizePost), total, totalPages }
        // Skip caching empty search results so a transient WP error isn't
        // sticky for 15 minutes.
        if (rows.length || !q) postsCache.set(cacheKey, value)
        return value
      })
    })
  })
}

function normalizePost(raw) {
  const emb = raw._embedded || {}
  const media = emb['wp:featuredmedia'] && emb['wp:featuredmedia'][0]
  const author = emb['author'] && emb['author'][0]
  return {
    id: raw.id,
    slug: raw.slug,
    title: raw.title && raw.title.rendered,
    excerpt: raw.excerpt && raw.excerpt.rendered,
    date: raw.date,
    featuredUrl: media && media.source_url,
    authorName: author && author.name,
  }
}

function formatDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d)) return ''
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
}

function pageHref({ categories, page, perPage, q }) {
  const params = new URLSearchParams()
  if (categories.length) params.set('categories', categories.join(','))
  params.set('page', String(page))
  if (perPage !== DEFAULT_PER_PAGE) params.set('show', String(perPage))
  if (q) params.set('q', q)
  return `${window.location.pathname}?${params.toString()}`
}

const Pagination = ({ categories, page, perPage, totalPages, onNavigate, q }) => {
  if (totalPages <= 1) return null
  const items = []
  const click = (target) => (e) => {
    e.preventDefault()
    onNavigate(target)
  }
  const linkTo = (p) => pageHref({ categories, page: p, perPage, q })

  items.push(
    <li className="page-item" key="prev">
      <a className="page-link" href={linkTo(Math.max(1, page - 1))} onClick={click(Math.max(1, page - 1))}>
        Previous
      </a>
    </li>,
  )
  for (let i = 1; i <= totalPages; i++) {
    items.push(
      <li className={`page-item ${i === page ? 'active' : ''}`} key={i}>
        <a className="page-link" href={linkTo(i)} onClick={click(i)}>
          {i}
        </a>
      </li>,
    )
  }
  items.push(
    <li className="page-item" key="next">
      <a className="page-link" href={linkTo(Math.min(totalPages, page + 1))} onClick={click(Math.min(totalPages, page + 1))}>
        Next
      </a>
    </li>,
  )

  return (
    <nav aria-label="Page navigation" className="mb70">
      <ul className="pagination justify-content-end">{items}</ul>
    </nav>
  )
}

const PostCard = ({ post }) => (
  <div className="col-lg-4 mb30">
    <div className="entry-card">
      <a href={`/post/${post.slug}`} className="entry-thumb">
        {post.featuredUrl && <img src={post.featuredUrl} alt="" className="img-fluid mb20" />}
        <span className="thumb-hover ti-back-right"></span>
      </a>
      <div className="entry-content">
        <h5 className="text-capitalize" dangerouslySetInnerHTML={{ __html: post.title || '' }} />
        <ul className="post-meta list-inline" style={{ fontSize: 'smaller' }}>
          {post.authorName && (
            <li className="list-inline-item">
              <i className="fa fa-user-circle-o"></i>
              {post.authorName}
            </li>
          )}
          <li className="list-inline-item">
            <i className="fa fa-calendar-o"></i>
            {formatDate(post.date)}
          </li>
        </ul>
        <p dangerouslySetInnerHTML={{ __html: post.excerpt || '' }} />
        <div className="text-right">
          <a href={`/post/${post.slug}`} className="btn-link btn">
            Read More
          </a>
        </div>
      </div>
    </div>
  </div>
)

const PostsList = () => {
  const [query, setQuery] = useState(readQuery)
  const [state, setState] = useState({ posts: null, totalPages: 1, error: null })

  // Stable derived values for effect deps.
  const catsKey = useMemo(() => query.categories.join(','), [query.categories])

  // Keep state in sync with URL when the user uses Back/Forward.
  useEffect(() => {
    const onPop = () => setQuery(readQuery())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  useEffect(() => {
    let cancelled = false
    setState((s) => ({ ...s, posts: null, error: null }))
    lookupCategoryIds(query.categories)
      .then((categoryIds) => fetchPostsPage({ categoryIds, page: query.page, perPage: query.perPage, q: query.q }))
      .then((res) => {
        if (cancelled) return
        setState({ posts: res.posts, totalPages: res.totalPages, error: null })
      })
      .catch((e) => {
        if (cancelled) return
        setState({ posts: [], totalPages: 1, error: e })
      })
    return () => {
      cancelled = true
    }
  }, [catsKey, query.page, query.perPage, query.q])

  const navigate = (page) => {
    const next = { ...query, page }
    window.history.pushState({}, '', pageHref({ categories: next.categories, page: next.page, perPage: next.perPage, q: next.q }))
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
              Showing posts matching <strong>{query.q}</strong>.{' '}
              <a href={pageHref({ categories: query.categories, page: 1, perPage: query.perPage, q: '' })}>
                Clear search
              </a>
            </p>
          )}
          <div className="row">
            {state.error && <div className="col-lg-12">Unable to load posts.</div>}
            {!state.error && !state.posts && <div className="col-lg-12">&nbsp;</div>}
            {state.posts && state.posts.length === 0 && (
              <div className="col-lg-12">No matching posts.</div>
            )}
            {state.posts && state.posts.map((p) => <PostCard post={p} key={p.id} />)}
          </div>
          <Pagination
            categories={query.categories}
            page={query.page}
            perPage={query.perPage}
            totalPages={state.totalPages}
            onNavigate={navigate}
            q={query.q}
          />
        </div>
      </div>
    </>
  )
}

export default PostsList
