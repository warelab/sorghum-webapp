import React, { useEffect, useState } from 'react'
import { getConfiguredCache } from 'money-clip'
import { expectedCount } from '../utils/typesense_counts'

const ONE_DAY = 1000 * 60 * 60 * 24

// Raw payload cache (full posts list, including embedded author + featured
// media via `_embed` on the WP REST call — see wp_cache.py RESOURCES).
const postsRawCache = getConfiguredCache({ maxAge: ONE_DAY, version: 1, name: 'postsRaw' })

const POSTS_URL = '/api/wp_cache/posts'
const TYPESENSE_COLLECTION = 'posts'

function fetchAndCache() {
  return fetch(POSTS_URL, { headers: { Accept: 'application/json' } })
    .then((r) => {
      if (!r.ok) throw new Error(`posts ${r.status}`)
      return r.json()
    })
    .then((rows) => {
      if (rows && rows.length) postsRawCache.set('all', rows)
      return rows
    })
}

function loadPosts() {
  return postsRawCache.get('all').then((cached) => {
    if (!cached || !cached.length) return fetchAndCache()
    return expectedCount(TYPESENSE_COLLECTION).then((expected) => {
      if (expected !== null && expected !== cached.length) {
        return fetchAndCache()
      }
      return cached
    })
  })
}

function formatDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d)) return iso
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

function authorName(post) {
  const emb = post && post._embedded
  const a = emb && emb.author && emb.author[0]
  return (a && a.name) || ''
}

function featuredImageUrl(post) {
  const emb = post && post._embedded
  const m = emb && emb['wp:featuredmedia'] && emb['wp:featuredmedia'][0]
  return (m && (m.source_url || m.guid)) || ''
}

const PostDetail = ({ slug }) => {
  const [status, setStatus] = useState('loading')
  const [post, setPost] = useState(null)

  useEffect(() => {
    let cancelled = false
    loadPosts()
      .then((rows) => {
        if (cancelled) return
        const match = (rows || []).find((p) => p && p.slug === slug)
        if (!match) {
          setStatus('not_found')
          return
        }
        setPost(match)
        setStatus('ready')
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [slug])

  useEffect(() => {
    if (status === 'ready' && post) {
      const t = (post.title && post.title.rendered) || ''
      if (t) document.title = `SorghumBase Post - ${t.replace(/<[^>]+>/g, '')}`
    }
  }, [status, post])

  if (status === 'loading') {
    return <div className="container pb50"><p style={{ color: '#888' }}>Loading post…</p></div>
  }
  if (status === 'not_found') {
    return (
      <div className="container pb50">
        <p>Post <code>{slug}</code> not found.</p>
        <p><a href="/posts">Back to all posts</a></p>
      </div>
    )
  }
  if (status === 'error') {
    return (
      <div className="container pb50">
        <p>Unable to load posts.</p>
        <p><a href="/posts">Back to all posts</a></p>
      </div>
    )
  }

  const title = (post.title && post.title.rendered) || ''
  const content = (post.content && post.content.rendered) || ''
  const author = authorName(post)
  const date = formatDate(post.date)
  const featured = featuredImageUrl(post)

  return (
    <div className="container pb50">
      <div className="row justify-content-md-center">
        <div className="col-md-9 mb40">
          <article>
            {featured && (
              <img src={featured} alt="" className="img-fluid mb30" />
            )}
            <div className="post-content">
              <h3 dangerouslySetInnerHTML={{ __html: title }} />
              <ul className="post-meta list-inline">
                {author && (
                  <li className="list-inline-item">
                    <i className="fa fa-user-circle-o"></i> {author}
                  </li>
                )}
                {date && (
                  <li className="list-inline-item">
                    <i className="fa fa-calendar-o"></i> {date}
                  </li>
                )}
              </ul>
              <div dangerouslySetInnerHTML={{ __html: content }} />
              <hr className="mb40" />
              <p><a href="/posts">Back to all posts</a></p>
            </div>
          </article>
        </div>
      </div>
    </div>
  )
}

export default PostDetail
