import React, { useEffect, useState } from 'react'
import { getConfiguredCache } from 'money-clip'
import { expectedTimestamp, timestampFromResponse } from '../utils/wp_cache_timestamps'
import { slugsMatch } from '../utils/slug'

// Separate cache instance from fundedProjects.js — the listing page stores
// projects in a *normalized* shape (dropping fields like project_description,
// awardees, project_images) which is fine for the table but not enough for
// the detail page. So we cache the raw payload here.
const projectsRawCache = getConfiguredCache({ maxAge: Infinity, version: 2, name: 'projectsRaw' })

const PROJECTS_URL = '/api/wp_cache/projects'
const RESOURCE = 'projects'

function fetchAndCache() {
  return fetch(PROJECTS_URL, { headers: { Accept: 'application/json' } })
    .then((r) => {
      if (!r.ok) throw new Error(`projects ${r.status}`)
      const ts = timestampFromResponse(r)
      return r.json().then((rows) => {
        if (rows && rows.length) projectsRawCache.set('all', { data: rows, fetched_at: ts })
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

function loadProjects() {
  return projectsRawCache.get('all').then((cached) => {
    const local = _unwrap(cached)
    if (!local) return fetchAndCache()
    return expectedTimestamp(RESOURCE).then((serverTs) => {
      if (serverTs !== null && serverTs > local.fetched_at) {
        return fetchAndCache()
      }
      return local.data
    })
  })
}

function stringList(value) {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

const InfoCard = ({ heading, children }) => (
  <div className="card mb10">
    <div className="card-header" role="tab">
      <h5 className="mb-0">{heading}</h5>
    </div>
    <div className="card-body">{children}</div>
  </div>
)

const ProjectDetail = ({ slug }) => {
  const [status, setStatus] = useState('loading')
  const [project, setProject] = useState(null)

  useEffect(() => {
    let cancelled = false
    loadProjects()
      .then((rows) => {
        if (cancelled) return
        const match = (rows || []).find((p) => p && slugsMatch(p.slug, slug))
        if (!match) {
          setStatus('not_found')
          return
        }
        setProject(match)
        setStatus('ready')
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [slug])

  if (status === 'loading') {
    return (
      <div className="container pb50">
        <div className="row justify-content-md-center">
          <div className="col-md-9 mb40" style={{ color: '#888' }}>Loading project…</div>
        </div>
      </div>
    )
  }

  if (status === 'not_found') {
    return (
      <div className="container pb50">
        <div className="row justify-content-md-center">
          <div className="col-md-9 mb40">
            <p>Project <code>{slug}</code> not found.</p>
            <p><a href="/projects">Back to all projects</a></p>
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
            <p>Unable to load projects.</p>
            <p><a href="/projects">Back to all projects</a></p>
          </div>
        </div>
      </div>
    )
  }

  const title = project.project_title || ''
  const logoUrl = project.project_logo && (project.project_logo.guid || project.project_logo.source_url)
  const fundingLabel = [project.funding_agency, project.funding_program, project.funding_subcategory]
    .filter(Boolean)
    .join(' ')
  const websites = stringList(project.project_web_sites)
  const news = stringList(project.project_news)
  const publications = stringList(project.project_publications)
  const images = stringList(project.project_images)

  return (
    <div className="container pb50">
      <div className="row justify-content-md-center">
        <div className="col-md-9 mb40">
          <article>
            <div className="clearfix pb20">
              <h2 className="mb0">
                {logoUrl && <img src={logoUrl} style={{ maxHeight: 80, marginRight: 12 }} alt="" />}
                <span dangerouslySetInnerHTML={{ __html: title }} />
              </h2>
            </div>
            {(project.start_date || project.end_date) && (
              <p>{project.start_date} to {project.end_date}</p>
            )}

            {fundingLabel && (
              <InfoCard heading={fundingLabel}>
                {project.award_id && (
                  <h6>
                    <a style={{ color: '#9F3D34' }} href={project.funding_link || '#'}>
                      Award ID {project.award_id}
                    </a>
                  </h6>
                )}
              </InfoCard>
            )}

            {project.awardees && (
              <InfoCard heading="Awardees">
                <h6 dangerouslySetInnerHTML={{ __html: project.awardees }} />
              </InfoCard>
            )}

            {project.project_description && (
              <InfoCard heading="Description">
                <div dangerouslySetInnerHTML={{ __html: project.project_description }} />
              </InfoCard>
            )}

            {websites.length > 0 && (
              <InfoCard heading="Project Links">
                {websites.map((w, i) => (
                  <h6 key={i} className="masonry-title mb1">
                    <a style={{ color: '#9F3D34' }} href={w.resource_url || '#'}>
                      <span dangerouslySetInnerHTML={{ __html: w.post_title || w.resource_url || '' }} />
                    </a>
                  </h6>
                ))}
              </InfoCard>
            )}

            {news.length > 0 && (
              <InfoCard heading="Project News">
                {news.map((slug, i) => {
                  const text = typeof slug === 'string' ? slug : (slug.post_title || slug.title || '')
                  const target = typeof slug === 'string'
                    ? slug.replace(/ /g, '-')
                    : (slug.slug || (slug.post_title || '').replace(/ /g, '-'))
                  return (
                    <h6 key={i} className="masonry-title mb1">
                      <a style={{ color: '#9F3D34' }} href={`/post/${target}`}>
                        <span dangerouslySetInnerHTML={{ __html: text }} />
                      </a>
                    </h6>
                  )
                })}
              </InfoCard>
            )}

            {publications.length > 0 && (
              <InfoCard heading="Project Publications">
                {publications.map((paper, i) => {
                  const id = paper && (paper.slug || paper.id)
                  const text = (paper && (paper.post_title || paper.title)) || String(id || '')
                  return (
                    <h6 key={i} className="masonry-title mb1">
                      <a style={{ color: '#9F3D34' }} href={`/paper/${id}`}>
                        <span dangerouslySetInnerHTML={{ __html: text }} />
                      </a>
                    </h6>
                  )
                })}
              </InfoCard>
            )}

            {images.length > 0 && (
              <>
                <br />
                <h6>Project Images</h6>
                <div className="row">
                  {images.map((img, i) => {
                    const src = img && (img.source_url || img.guid || (img.s && img.s.source_url))
                    if (!src) return null
                    return (
                      <div key={i} className="col-md-4 mb20">
                        <img src={src} alt={img.caption || ''} className="img-fluid" />
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </article>
        </div>
      </div>
    </div>
  )
}

export default ProjectDetail
