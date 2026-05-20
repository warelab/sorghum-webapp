import React, { useEffect, useState } from 'react'
import { getConfiguredCache } from 'money-clip'
import { expectedTimestamp, timestampFromResponse } from '../utils/wp_cache_timestamps'

const ONE_DAY = 1000 * 60 * 60 * 24

const homePostsCache = getConfiguredCache({
  maxAge: ONE_DAY,
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

function loadHomePosts() {
  return homePostsCache.get('all').then((cached) => {
    const local = cached && cached.data ? cached : null
    if (!local) return fetchAndCache()
    return expectedTimestamp(RESOURCE).then((serverTs) => {
      if (serverTs !== null && serverTs > (local.fetched_at || 0)) {
        return fetchAndCache()
      }
      return local.data
    })
  })
}

let sharedPromise = null
function loadHomePostsShared() {
  if (!sharedPromise) sharedPromise = loadHomePosts().catch((e) => { sharedPromise = null; throw e })
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
    loadHomePostsShared()
      .then((data) => {
        if (!cancelled) setPosts((data && data[sectionKey]) || [])
      })
      .catch((e) => {
        if (!cancelled) setError(e)
      })
    return () => {
      cancelled = true
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
