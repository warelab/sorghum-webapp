import React, { useEffect, useState } from 'react'
import { getConfiguredCache } from 'money-clip'

const WP_BASE =
  'https://content.sorghumbase.org/wordpress/index.php/wp-json/wp/v2'

const FIFTEEN_MIN = 1000 * 60 * 15

const homePostsCache = getConfiguredCache({
  maxAge: FIFTEEN_MIN,
  version: 1,
})

const SECTIONS = {
  news: { categoryId: 2, heading: 'Latest Community News', link: '/posts?categories=news' },
  highlights: { categoryId: 1022, heading: 'Recent Research', link: '/posts?categories=research-highlights' },
  topics: { categoryId: 3092, heading: 'Special Topics', link: '/posts?categories=topics' },
}

function fetchPosts(categoryId) {
  const url = `${WP_BASE}/posts?categories=${categoryId}&per_page=3&orderby=date&order=desc&_embed=wp:featuredmedia`
  return fetch(url, { headers: { Accept: 'application/json' } }).then((r) => {
    if (!r.ok) throw new Error(`wp posts ${r.status}`)
    return r.json()
  })
}

function normalizePost(raw) {
  const media = raw._embedded && raw._embedded['wp:featuredmedia']
  const featuredUrl = media && media[0] && media[0].source_url
  return {
    slug: raw.slug,
    title: raw.title && raw.title.rendered,
    excerpt: raw.excerpt && raw.excerpt.rendered,
    date: raw.date,
    featuredUrl,
  }
}

function formatDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d)) return ''
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
}

function loadSection(key) {
  return homePostsCache.get(key).then((cached) => {
    if (cached) return cached
    return fetchPosts(SECTIONS[key].categoryId).then((raw) => {
      const posts = raw.map(normalizePost)
      homePostsCache.set(key, posts)
      return posts
    })
  })
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
    loadSection(sectionKey)
      .then((data) => {
        if (!cancelled) setPosts(data)
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
