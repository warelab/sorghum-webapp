import React, { useEffect, useMemo, useState } from 'react'
import { getConfiguredCache } from 'money-clip'

const ONE_DAY = 1000 * 60 * 60 * 24

const eventsCache = getConfiguredCache({ maxAge: ONE_DAY, version: 1 })

const EVENTS_URL = '/api/wp_cache/events'

const BANNER_URL =
  'https://content.sorghumbase.org/wordpress/wp-content/uploads/2018/06/sorghum_panicle-e1644529666393.jpg'

function readPast() {
  const params = new URLSearchParams(window.location.search)
  return params.get('past') ? true : false
}

function loadEvents() {
  return eventsCache.get('all').then((cached) => {
    if (cached) return cached
    return fetch(EVENTS_URL, { headers: { Accept: 'application/json' } })
      .then((r) => {
        if (!r.ok) throw new Error(`events ${r.status}`)
        return r.json()
      })
      .then((rows) => {
        const events = rows.map(normalizeEvent)
        eventsCache.set('all', events)
        return events
      })
  })
}

function normalizeEvent(raw) {
  const fi = Array.isArray(raw.featured_image)
    ? raw.featured_image[0]
    : raw.featured_image
  const featuredUrl = fi && (fi.guid || fi.source_url) || null
  return {
    id: raw.id,
    slug: raw.slug,
    title: raw.title && raw.title.rendered,
    content: raw.content && raw.content.rendered,
    startDate: raw.start_date,
    endDate: raw.end_date,
    eventUrl: raw.event_url,
    organizer: raw.organizer,
    location: raw.location,
    shortName: raw.short_name,
    mainEvent: raw.main_event,
    featuredUrl,
  }
}

function parseDate(ymd) {
  // start_date / end_date come back as "YYYY-MM-DD"; "0000-00-00" means "none".
  if (!ymd || ymd === '0000-00-00') return null
  const [y, m, d] = ymd.split('-').map((s) => parseInt(s, 10))
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d)
}

function formatDate(ymd) {
  const d = parseDate(ymd)
  if (!d) return ''
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

function splitEvents(events) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const past = []
  const future = []
  for (const e of events) {
    const d = parseDate(e.startDate)
    if (d && d < today) past.push(e)
    else future.push(e)
  }
  return { past, future }
}

const EventCard = ({ event }) => {
  const [open, setOpen] = useState(false)
  const startStr = formatDate(event.startDate)
  const endStr = formatDate(event.endDate)
  const accordionId = `accordion${event.id}`
  const collapseId = `collapse${event.id}`
  const headingId = `heading${event.id}`

  const toggle = (e) => {
    e.preventDefault()
    setOpen((v) => !v)
  }

  const detailBody = (
    <>
      <h5 dangerouslySetInnerHTML={{ __html: event.location || '' }} />
      <ul className="post-meta list-inline">
        <li className="list-inline-item">
          <i className="fa fa-bank"></i>
          <span dangerouslySetInnerHTML={{ __html: event.organizer || '' }} />
        </li>
      </ul>
      <div className="mb10" dangerouslySetInnerHTML={{ __html: event.content || '' }} />
      {event.mainEvent ? (
        <a href={`#${event.mainEvent}`} className="btn btn-outline-secondary btn-sm">
          Main Event
        </a>
      ) : (
        <a href={event.eventUrl} className="btn btn-outline-secondary btn-sm">
          Event
        </a>
      )}
    </>
  )

  return (
    <div className="vtimeline-point">
      <div id={String(event.id)} style={{ position: 'absolute', top: '-90px' }}></div>
      <div className="vtimeline-icon">
        <i className="fa fa-calendar"></i>
      </div>
      <div className="vtimeline-block">
        <div className="vtimeline-date">{startStr}</div>
        <div className="vtimeline-content" id={accordionId}>
          <div className="accordion-header" role="tab" id={headingId}>
            <div style={{ minHeight: '100px' }}>
              {event.featuredUrl && (
                <img
                  style={{ float: 'right', height: '100px' }}
                  src={event.featuredUrl}
                  alt=""
                  className="img-fluid mb20"
                />
              )}
              <h2 dangerouslySetInnerHTML={{ __html: event.title || '' }} />
              {event.shortName && <h4>{event.shortName}</h4>}
              <h5>
                {startStr}
                {endStr && ` - ${endStr}`}
              </h5>
            </div>
            <a
              className={open ? '' : 'collapsed'}
              data-toggle="collapse"
              data-parent={`#${accordionId}`}
              href={`#${collapseId}`}
              aria-expanded={open ? 'true' : 'false'}
              aria-controls={collapseId}
              onClick={toggle}
            >
              Event details
            </a>
          </div>
          <div
            id={collapseId}
            className={`collapse${open ? ' show' : ''}`}
            role="tabpanel"
            aria-labelledby={headingId}
          >
            {detailBody}
          </div>
        </div>
      </div>
    </div>
  )
}

const EventsList = () => {
  const [past, setPast] = useState(readPast)
  const [events, setEvents] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    const onPop = () => setPast(readPast())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  useEffect(() => {
    let cancelled = false
    loadEvents()
      .then((data) => {
        if (!cancelled) setEvents(data)
      })
      .catch((e) => {
        if (!cancelled) setError(e)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const { displayed, toggleHref, toggleLabel, heading } = useMemo(() => {
    if (!events) {
      return {
        displayed: [],
        toggleHref: past ? '/events' : '/events?past=true',
        toggleLabel: past ? 'View upcoming events' : 'View past events',
        heading: past ? 'Past Events' : 'Upcoming Events',
      }
    }
    const { past: pastEvents, future: futureEvents } = splitEvents(events)
    const sortedFuture = [...futureEvents].sort((a, b) => {
      const cmp = (a.startDate || '').localeCompare(b.startDate || '')
      return past ? -cmp : cmp
    })
    const sortedPast = [...pastEvents].sort(
      (a, b) => -(a.startDate || '').localeCompare(b.startDate || ''),
    )
    return {
      displayed: past ? sortedPast : sortedFuture,
      toggleHref: past ? '/events' : '/events?past=true',
      toggleLabel: past ? 'View upcoming events' : 'View past events',
      heading: past ? 'Past Events' : 'Upcoming Events',
    }
  }, [events, past])

  return (
    <>
      <div
        className="page-titles-img title-space-md parallax-overlay bg-parallax"
        data-jarallax='{"speed": 0.4}'
        style={{
          backgroundImage: `url("${BANNER_URL}")`,
          backgroundPosition: 'top center',
        }}
      >
        <div className="container">
          <div className="row">
            <div className="col-md-12">
              <h1 className="text-uppercase">{heading}</h1>
            </div>
          </div>
        </div>
      </div>
      <div className="pt10 title">
        <a href={toggleHref} className="nav-link" style={{ float: 'right' }}>
          {toggleLabel}
        </a>
      </div>
      <div className="container mb80">
        <div id="eventList" className="page-timeline">
          {error && <div>Unable to load events.</div>}
          {!error && !events && <div>&nbsp;</div>}
          {events && displayed.map((e) => <EventCard event={e} key={e.id} />)}
        </div>
      </div>
    </>
  )
}

export default EventsList
