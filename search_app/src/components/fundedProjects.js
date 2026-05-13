import React, { useEffect, useRef, useState } from 'react'
import { getConfiguredCache } from 'money-clip'

const ONE_DAY = 1000 * 60 * 60 * 24
const projectsCache = getConfiguredCache({ maxAge: ONE_DAY, version: 1 })

const PROJECTS_URL = '/api/wp_cache/projects'

function titleCase(s) {
  return (s || '').replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
}

function normalize(raw) {
  return {
    id: raw.id,
    slug: raw.slug,
    funding_agency: raw.funding_agency || '',
    funding_program: raw.funding_program || '',
    funding_subcategory: raw.funding_subcategory || '',
    funding_link: raw.funding_link || '',
    award_id: raw.award_id || '',
    award_amount: raw.award_amount || '',
    project_title: titleCase(raw.project_title || ''),
    start_date: raw.start_date || '',
    end_date: raw.end_date || '',
    pi: (raw.pi || []).join(','),
    orgs: raw.organizations || [],
    orgstr: (raw.organizations || []).map((o) => o.post_title).join(' '),
  }
}

function loadProjects() {
  return projectsCache.get('all').then((cached) => {
    if (cached && cached.length) return cached
    return fetch(PROJECTS_URL, { headers: { Accept: 'application/json' } })
      .then((r) => {
        if (!r.ok) throw new Error(`projects ${r.status}`)
        return r.json()
      })
      .then((rows) => {
        const projects = rows.map(normalize)
        projects.sort((a, b) => (b.start_date || '').localeCompare(a.start_date || ''))
        if (projects.length) projectsCache.set('all', projects)
        return projects
      })
  })
}

function reformatDates(a, b) {
  const x = (a || '').split('-')
  const y = (b || '').split('-')
  if (x.length < 2 || y.length < 2) return ''
  return `${x[1]}/${x[0]} to ${y[1]}/${y[0]}`
}

function dateSorter(d1, d2) {
  return new Date(d1) - new Date(d2)
}

function buildColumns(projects) {
  const agencies = {}
  const programs = {}
  const categories = {}
  projects.forEach((p) => {
    agencies[p.funding_agency] = (agencies[p.funding_agency] || 0) + 1
    programs[p.funding_program] = (programs[p.funding_program] || 0) + 1
    categories[p.funding_subcategory] = (categories[p.funding_subcategory] || 0) + 1
  })
  return [
    { name: 'pi', header: 'PI(s)', editable: false, filterable: false },
    {
      name: 'orgs',
      header: 'Organizations',
      editable: false,
      filterable: false,
      value: (item) => (item.orgs || []).map((o) => o.post_title).join(' '),
    },
    {
      name: 'project_title',
      editable: false,
      width: '550px',
      header: 'Project Title',
      filterable: false,
      html: (item) =>
        `<span class="sb-link"><a href="/project/${item.slug}">${item.project_title}</a></span>`,
    },
    {
      name: 'start_date',
      header: 'Start Date',
      type: 'date',
      editable: false,
      filterable: false,
      sort: dateSorter,
    },
    {
      name: 'funding_agency',
      header: 'Funding Agency',
      editable: false,
      filterable: true,
      filter: Object.keys(agencies).sort((a, b) => agencies[b] - agencies[a]),
    },
    {
      name: 'funding_program',
      header: 'Program',
      editable: false,
      filterable: true,
      filter: Object.keys(programs).sort((a, b) => programs[b] - programs[a]),
    },
    {
      name: 'funding_subcategory',
      visible: false,
      header: 'Category',
      editable: false,
      filterable: true,
      filter: Object.keys(categories).sort((a, b) => categories[b] - categories[a]),
    },
    {
      name: 'award_id',
      header: 'Award ID',
      editable: false,
      filterable: false,
      html: (item) =>
        `<a class="btn-link btn" target="_blank" href="${item.funding_link}">${item.award_id}</a>`,
    },
    {
      name: 'id',
      visible: false,
      editable: false,
      header: 'CMS',
      filterable: false,
      html: (item) =>
        `<a class="btn-link btn" target="_blank" href="https://content.sorghumbase.org/wordpress/wp-admin/post.php?action=edit&post=${item.id}">edit</a>`,
    },
    { name: 'orgstr', visible: false, editable: false, filterable: false, header: 'idx' },
  ]
}

async function initFundingMap(places) {
  if (typeof google === 'undefined' || !google.maps || !google.maps.importLibrary) return
  const { Map, InfoWindow } = await google.maps.importLibrary('maps')
  const { AdvancedMarkerElement } = await google.maps.importLibrary('marker')
  const mapElement = document.getElementById('funding_map')
  if (!mapElement) return
  const fundingMap = new Map(mapElement, {
    center: { lat: 39.197437, lng: -96.5846884 },
    zoom: 4,
    mapId: 'SB_FUNDING_MAP',
  })
  const infoWindow = new InfoWindow()
  for (const [plusCode, place] of Object.entries(places)) {
    fetch(`https://data.gramene.org/google_api/geocode/${plusCode}`)
      .then((res) => res.json())
      .then((res) => {
        const location = res.geometry.location
        const marker = new AdvancedMarkerElement({
          position: location,
          map: fundingMap,
          title: place.post_title,
        })
        marker.addListener('click', () => {
          const content = document.createElement('div')
          content.innerHTML = `<h5>${marker.title}</h5><button class="btn-link btn" onclick="document.getElementById('funding_search').value='${marker.title}';window.myDataTable.search('${marker.title}')">Filter Projects</button>`
          infoWindow.close()
          infoWindow.setContent(content)
          infoWindow.open(marker.map, marker)
        })
      })
      .catch(() => {})
  }
}

const FundedProjects = () => {
  const [projects, setProjects] = useState(null)
  const [error, setError] = useState(null)
  const initRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    loadProjects()
      .then((d) => {
        if (!cancelled) setProjects(d)
      })
      .catch((e) => {
        if (!cancelled) setError(e)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!projects || initRef.current) return
    if (typeof window.FathGrid !== 'function') {
      console.warn('FathGrid not loaded; skipping table init')
      return
    }
    initRef.current = true

    const tableData = projects.map((p) => ({
      ...p,
      dates: reformatDates(p.start_date, p.end_date),
    }))

    window.myDataTable = window.FathGrid('projects_tbl', {
      editable: false,
      filterable: true,
      showGrouping: false,
      columns: buildColumns(tableData),
      data: tableData,
    })

    const places = {}
    tableData.forEach((item) => (item.orgs || []).forEach((o) => {
      if (o.plus_code) places[o.plus_code] = o
    }))
    initFundingMap(places)
  }, [projects])

  const onSearch = (e) => {
    if (window.myDataTable) window.myDataTable.search(e.target.value)
  }

  return (
    <div className="container pt90">
      {error && <div>Unable to load projects.</div>}
      <div id="funding_map"></div>
      <div className="input-group mb-3">
        <div className="input-group-prepend">
          <span className="input-group-text" id="inputGroup-sizing-default">
            Search
          </span>
        </div>
        <input
          id="funding_search"
          onChange={onSearch}
          type="text"
          className="form-control"
          aria-label="Default"
          aria-describedby="inputGroup-sizing-default"
        />
      </div>
      <table id="projects_tbl" className="table table-hover table-bordered">
        <thead className="thead-light"></thead>
        <tbody></tbody>
      </table>
      {!error && !projects && <div>&nbsp;</div>}
    </div>
  )
}

export default FundedProjects
