import React, { useEffect, useState } from 'react'
import { getConfiguredCache } from 'money-clip'
import { timestampFromResponse } from '../utils/wp_cache_timestamps'
import { staleWhileRevalidate } from '../utils/wp_cache_swr'

const homePostsCache = getConfiguredCache({
  maxAge: Infinity,
  version: 2,
  name: 'homePosts',
})

const HOME_POSTS_URL = '/api/wp_cache/home_posts'
const RESOURCE = 'home_posts'

const SECTIONS = {
  news:       { heading: 'Latest Community News', link: '/posts?categories=news' },
  highlights: { heading: 'Recent Research',       link: '/posts?categories=research-highlights' },
  topics:     { heading: 'Special Topics',        link: '/posts?categories=topics' },
}

function fetchAndCache() {
  return fetch(HOME_POSTS_URL, { headers: { Accept: 'application/json' } }).then((r) => {
    if (!r.ok) throw new Error(`home_posts ${r.status}`)
    const ts = timestampFromResponse(r)
    return r.json().then((data) => {
      if (data) homePostsCache.set('all', { data, fetched_at: ts })
      return data
    })
  })
}

function _unwrap(cached) {
  if (!cached || !cached.data) return null
  return { data: cached.data, fetched_at: cached.fetched_at || 0 }
}

// `onFresh` is called if revalidation finds a newer copy on the server, so a
// cached list can render immediately and update in place a moment later.
function loadHomePosts(onFresh) {
  return homePostsCache.get('all').then((cached) =>
    staleWhileRevalidate({
      cached: _unwrap(cached),
      resource: RESOURCE,
      refetch: fetchAndCache,
      onFresh,
    }),
  )
}

// Every mounted section shares one load, so `sharedPromise` can only ever
// resolve once — fresh data can't be pushed back through it. Instead the single
// revalidation fans out to the mounted sections through these listeners, which
// leaves the memo's single-resolve contract untouched.
let sharedPromise = null
const freshListeners = new Set()

function onSharedFresh(listener) {
  freshListeners.add(listener)
  return () => freshListeners.delete(listener)
}

function loadHomePostsShared() {
  if (!sharedPromise) {
    sharedPromise = loadHomePosts((fresh) => {
      freshListeners.forEach((listener) => listener(fresh))
    }).catch((e) => { sharedPromise = null; throw e })
  }
  return sharedPromise
}

function formatDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d)) return ''
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
}

const PostCard = ({ post }) => (
  <div className="col-lg-4 mb30">
    <div className="entry-card">
      <a href={`/post/${post.slug}`} className="entry-thumb">
        {post.featuredUrl && (
          <img src={post.featuredUrl} alt="" className="img-fluid mb20" />
        )}
        <span className="thumb-hover ti-back-right"></span>
      </a>
      <div className="entry-content">
        <h5
          className="text-capitalize"
          dangerouslySetInnerHTML={{ __html: post.title || '' }}
        />
        <ul className="post-meta list-inline" style={{ fontSize: 'smaller' }}>
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

const HomeSection = ({ sectionKey }) => {
  const meta = SECTIONS[sectionKey]
  const [posts, setPosts] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    // Subscribe before kicking off the load: revalidation only ever reports back
    // after the network round trip, so the cached copy below still lands first.
    const unsubscribe = onSharedFresh((fresh) => {
      if (!cancelled) setPosts((fresh && fresh[sectionKey]) || [])
    })
    loadHomePostsShared()
      .then((data) => {
        if (!cancelled) setPosts((data && data[sectionKey]) || [])
      })
      .catch((e) => {
        if (!cancelled) setError(e)
      })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [sectionKey])

  return (
    <div className="pt90 pb60">
      <div className="container">
        <div className="title-heading1 mb40">
          <a href={meta.link} className="sb-link">
            <h3>{meta.heading}</h3>
          </a>
        </div>
        <div className="row">
          {error && <div className="col-lg-12">Unable to load posts.</div>}
          {!error && !posts && <div className="col-lg-12">&nbsp;</div>}
          {posts && posts.map((p) => <PostCard post={p} key={p.slug} />)}
        </div>
      </div>
    </div>
  )
}

export default HomeSection
