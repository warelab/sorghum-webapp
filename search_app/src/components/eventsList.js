import React, { useEffect, useMemo, useRef, useState } from 'react'
import { getConfiguredCache } from 'money-clip'
import { expectedCount } from '../utils/typesense_counts'

const ONE_DAY = 1000 * 60 * 60 * 24

const eventsCache = getConfiguredCache({ maxAge: ONE_DAY, version: 1 })

const EVENTS_URL = '/api/wp_cache/events'
const TYPESENSE_COLLECTION = 'events'

const BANNER_URL =
  'https://content.sorghumbase.org/wordpress/wp-content/uploads/2018/06/sorghum_panicle-e1644529666393.jpg'

// `?past=YYYY` → past events for that calendar year.
// `?past=` (any other truthy value) → past view, latest year auto-picked.
// no `past=` → upcoming view.
function readUrl() {
  const params = new URLSearchParams(window.location.search)
  const pastRaw = params.get('past')
  let selectedYear = null
  if (pastRaw) {
    if (/^\d{4}$/.test(pastRaw)) selectedYear = parseInt(pastRaw, 10)
    else selectedYear = 'latest'
  }
  return {
    selectedYear,
    eventSlug: (params.get('event') || '').trim(),
  }
}

function startYear(e) {
  const d = parseDate(e.startDate)
  return d ? d.getFullYear() : null
}

function fetchAndCache() {
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
}

function loadEvents() {
  return eventsCache.get('all').then((cached) => {
    if (!cached || !cached.length) return fetchAndCache()
    return expectedCount(TYPESENSE_COLLECTION).then((expected) => {
      if (expected !== null && expected !== cached.length) {
        return fetchAndCache()
      }
      return cached
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

const EventCard = ({ event, defaultOpen, anchorRef }) => {
  const [open, setOpen] = useState(!!defaultOpen)
  const startStr = formatDate(event.startDate)
  const endStr = formatDate(event.endDate)
  const accordionId = `accordion${event.id}`
  const collapseId = `collapse${event.id}`
  const headingId = `heading${event.id}`

  // Open when the parent flags this card as focused (slug match from URL).
  useEffect(() => {
    if (defaultOpen) setOpen(true)
  }, [defaultOpen])

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
    <div className="vtimeline-point" ref={anchorRef}>
      <div id={String(event.id)} style={{ position: 'absolute', top: '-90px' }}></div>
      <div id={`event-${event.slug}`} style={{ position: 'absolute', top: '-90px' }}></div>
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
  const [{ selectedYear, eventSlug }, setUrlState] = useState(readUrl)
  const [events, setEvents] = useState(null)
  const [error, setError] = useState(null)
  const focusedRef = useRef(null)
  // Track whether we've already auto-scrolled for the current `eventSlug` so
  // switching tabs doesn't keep yanking the viewport.
  const scrolledForSlugRef = useRef(null)

  useEffect(() => {
    const onPop = () => setUrlState(readUrl())
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

  // When ?event=<slug> is present, override the view selection to match the
  // target event's date so the card actually shows up in the timeline.
  const focusedEvent = useMemo(() => {
    if (!events || !eventSlug) return null
    return events.find((e) => e && e.slug === eventSlug) || null
  }, [events, eventSlug])

  // Years that have past events, descending. Derived from data.
  const pastYears = useMemo(() => {
    if (!events) return []
    const { past } = splitEvents(events)
    const set = new Set()
    for (const e of past) {
      const y = startYear(e)
      if (y) set.add(y)
    }
    return Array.from(set).sort((a, b) => b - a)
  }, [events])

  // Resolve the effective year given the URL state, focused event, and the
  // set of years that actually have events.
  const effectiveYear = useMemo(() => {
    if (focusedEvent) {
      const d = parseDate(focusedEvent.startDate)
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      if (d && d >= today) return null // upcoming
      const y = startYear(focusedEvent)
      return y || (pastYears[0] || null)
    }
    if (selectedYear === null) return null
    if (selectedYear === 'latest') return pastYears[0] || null
    // explicit numeric year — fall back to the latest if the URL year has
    // no events (e.g. someone typed in a year that pre-dates the archive).
    if (pastYears.includes(selectedYear)) return selectedYear
    return pastYears[0] || null
  }, [focusedEvent, selectedYear, pastYears])

  const isUpcoming = effectiveYear === null

  const { displayed, heading } = useMemo(() => {
    if (!events) {
      return {
        displayed: [],
        heading: isUpcoming ? 'Upcoming Events' : `Past Events · ${effectiveYear}`,
      }
    }
    const { past: pastEvents, future: futureEvents } = splitEvents(events)
    if (isUpcoming) {
      const sortedFuture = [...futureEvents].sort((a, b) =>
        (a.startDate || '').localeCompare(b.startDate || ''),
      )
      return { displayed: sortedFuture, heading: 'Upcoming Events' }
    }
    const yearEvents = pastEvents
      .filter((e) => startYear(e) === effectiveYear)
      .sort((a, b) => -(a.startDate || '').localeCompare(b.startDate || ''))
    return { displayed: yearEvents, heading: `Past Events · ${effectiveYear}` }
  }, [events, isUpcoming, effectiveYear])

  const buttonClass = (active) =>
    `btn btn-sm mr5 mb5 ${active ? 'btn-primary' : 'btn-outline-secondary'}`

  // Scroll the focused card into view once after the displayed list renders.
  // The sticky navbar floats over content, so offset by its height so the
  // event title isn't tucked behind it.
  useEffect(() => {
    if (!focusedEvent || !focusedRef.current) return
    if (scrolledForSlugRef.current === focusedEvent.slug) return
    scrolledForSlugRef.current = focusedEvent.slug
    requestAnimationFrame(() => {
      const el = focusedRef.current
      if (!el) return
      const nav = document.querySelector('nav.navbar')
      const navH = nav ? nav.getBoundingClientRect().height : 0
      const padding = 16 // breathing room under the navbar
      const top = el.getBoundingClientRect().top + window.scrollY - navH - padding
      window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
    })
  }, [focusedEvent, displayed])

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
      <div className="container pt20 pb10">
        <div className="d-flex flex-wrap align-items-center" style={{ gap: '0.25rem' }}>
          <a href="/events" className={buttonClass(isUpcoming)}>Upcoming</a>
          {pastYears.map((year) => (
            <a
              key={year}
              href={`/events?past=${year}`}
              className={buttonClass(!isUpcoming && effectiveYear === year)}
            >
              {year}
            </a>
          ))}
        </div>
      </div>
      <div className="container mb80">
        <div id="eventList" className="page-timeline">
          {error && <div>Unable to load events.</div>}
          {!error && !events && <div>&nbsp;</div>}
          {events && focusedEvent === null && eventSlug && (
            <div style={{ color: '#9F3D34' }}>
              No event matching <code>{eventSlug}</code>.
            </div>
          )}
          {events && !displayed.length && (
            <div style={{ color: '#888' }}>No events in this view.</div>
          )}
          {events && displayed.map((e) => {
            const isFocused = focusedEvent && e.slug === focusedEvent.slug
            return (
              <EventCard
                event={e}
                key={e.id}
                defaultOpen={isFocused}
                anchorRef={isFocused ? focusedRef : null}
              />
            )
          })}
        </div>
      </div>
    </>
  )
}

export default EventsList
