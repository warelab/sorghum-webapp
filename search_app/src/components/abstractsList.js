import React, { useEffect, useRef, useState } from 'react'
import { loadAbstracts } from '../utils/abstracts_cache'
import { loadSicnaTags } from '../utils/sicna_tags_cache'

// Mirrors controllers/abstracts.py: tag name "SICNA 2024" -> ("SICNA", "2024").
const TAG_YEAR_RE = /^(.*?)\s+(\d{4})\s*$/

function deriveConfYear(tag) {
  if (!tag) return ['', '']
  const name = (tag.name || '').trim()
  const m = TAG_YEAR_RE.exec(name)
  return m ? [m[1].trim(), m[2]] : [name, '']
}

// Mirrors _normalize_orgs in controllers/abstracts.py: affiliation comes in
// as strings, as rich dicts with post_title, or as bare numeric IDs.
function normalizeOrgs(presenter) {
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

function buildRow(raw, tagById) {
  const presenter = (raw.presenting_author || [{}])[0] || {}
  const first = (presenter.first_name || '').trim()
  const last = (presenter.last_name || '').trim()
  const author = last && first ? `${last}, ${first}` : (last || first || '')

  const orgs = normalizeOrgs(presenter)
  const tagIds = raw.tags || []
  const [conf, year] = deriveConfYear(tagIds[0] != null ? tagById[tagIds[0]] : null)

  return {
    id: raw.id || 0,
    slug: raw.slug || '',
    title: (raw.title && raw.title.rendered) || '',
    content: ((raw.content && raw.content.rendered) || '').replace(/<[^>]+>/g, ''),
    type: raw.presentation_type || '',
    session: raw.session || '',
    author,
    orgs,
    orgstr: orgs.map((o) => o.post_title).join(' '),
    conference: `${conf} ${year}`.trim(),
  }
}

const AbstractsList = () => {
  const [status, setStatus] = useState('loading')
  const tableRef = useRef(null)
  const initRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([loadAbstracts(), loadSicnaTags()])
      .then(([abstracts, tags]) => {
        if (cancelled) return
        const tagById = {}
        ;(tags || []).forEach((t) => { if (t && t.id != null) tagById[t.id] = t })
        const rows = (abstracts || []).map((a) => buildRow(a, tagById))
        if (typeof window.FathGrid !== 'function') {
          console.warn('FathGrid not loaded; cannot render abstracts table')
          setStatus('error')
          return
        }
        if (initRef.current) return
        initRef.current = true

        window.myDataTable = window.FathGrid('abstracts_tbl', {
          editable: false,
          filterable: true,
          showGrouping: false,
          sortBy: [1],
          columns: [
            { name: 'author', header: 'Presenting Author', editable: false, filterable: false },
            {
              name: 'title', editable: false, header: 'Title', filterable: false,
              html: (item) => `<span class="sb-link"><a href="/abstract/${item.slug}">${item.title}</a></span>`,
            },
            {
              name: 'orgs', header: 'Institution', editable: false, filterable: false,
              value: (item) => (item.orgs || []).map((o) => o.post_title).join(' '),
              html: (item) => {
                const lis = (item.orgs || []).map((o) => `<li>${o.post_title}</li>`).join('')
                return `<ul class="list-unstyled sb-link">${lis}</ul>`
              },
            },
            { name: 'type', editable: false, header: 'Presentation', filterable: false },
            { name: 'conference', header: 'Conference', editable: false, filterable: false },
            {
              name: 'id', visible: false, editable: false, header: 'CMS', filterable: false,
              html: (item) => `<a class="btn-link btn" target="_blank" href="https://content.sorghumbase.org/wordpress/wp-admin/post.php?action=edit&post=${item.id}">edit</a>`,
            },
            { name: 'orgstr', visible: false, editable: false, filterable: true, header: 'idx' },
            { name: 'content', visible: false, editable: false, filterable: true, header: 'abstract' },
          ],
          data: rows,
        })

        // Honor ?q= from the URL.
        const urlQ = new URLSearchParams(window.location.search).get('q') || ''
        if (urlQ && window.myDataTable) {
          const input = document.getElementById('abstracts_search')
          if (input) input.value = urlQ
          window.myDataTable.search(urlQ)
        }
        setStatus('ready')
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="container pt90">
      <div className="input-group mb-3">
        <div className="input-group-prepend">
          <span className="input-group-text">Search</span>
        </div>
        <input
          id="abstracts_search"
          type="text"
          className="form-control"
          aria-label="Search abstracts"
          onChange={(e) => {
            if (window.myDataTable) window.myDataTable.search(e.target.value)
          }}
        />
      </div>
      {status === 'loading' && (
        <p style={{ color: '#888' }}>Loading abstracts…</p>
      )}
      {status === 'error' && (
        <p style={{ color: '#9F3D34' }}>Unable to load abstracts.</p>
      )}
      <table id="abstracts_tbl" className="table table-hover table-bordered" ref={tableRef}>
        <thead className="thead-light"></thead>
        <tbody></tbody>
      </table>
    </div>
  )
}

export default AbstractsList
