import React, { useEffect, useState } from 'react'
import { getConfiguredCache } from 'money-clip'

const ONE_DAY = 1000 * 60 * 60 * 24

const peopleCache = getConfiguredCache({ maxAge: ONE_DAY, version: 2 })

const PEOPLE_URL = '/api/people'

const SECTIONS = [
  { key: 'team', heading: 'Sorghumbase Team', anchor: 'team', showOrg: false },
  { key: 'sac', heading: 'Sorghum User Working Group (SUWG)', anchor: 'sac', showOrg: true },
  { key: 'escapees', heading: 'Former Team Members', anchor: 'escapees', showOrg: false, hideTitle: true },
]

function isUsablePayload(payload) {
  if (!payload) return false
  return Boolean(
    (payload.team && payload.team.length) ||
      (payload.sac && payload.sac.length) ||
      (payload.escapees && payload.escapees.length),
  )
}

function loadPeople() {
  return peopleCache.get('all').then((cached) => {
    if (isUsablePayload(cached)) return cached
    return fetch(PEOPLE_URL, { headers: { Accept: 'application/json' } })
      .then((r) => {
        if (!r.ok) throw new Error(`people ${r.status}`)
        return r.json()
      })
      .then((payload) => {
        // Only persist non-empty payloads so a one-off unauthenticated
        // response (empty role lists) doesn't get pinned for 24 hours.
        if (isUsablePayload(payload)) peopleCache.set('all', payload)
        return payload
      })
  })
}

const PersonCard = ({ person, showOrg, hideTitle }) => (
  <div className="col-lg-4 col-md-6 mb30">
    <div className="team-card-default">
      <img
        src={person.imgURL}
        style={{ height: '96px' }}
        alt=""
        className="img-fluid rounded-circle centered"
      />
      <div className="team-default-content text-center pt30 pb20">
        <h4
          className="mb0 text-uppercase"
          dangerouslySetInnerHTML={{ __html: person.name || '' }}
        />
        {!hideTitle && person.jobTitle && (
          <>
            <span dangerouslySetInnerHTML={{ __html: person.jobTitle }} />
            <br />
          </>
        )}
        {showOrg && person.organization && (
          <span
            className="font-weight-bold"
            dangerouslySetInnerHTML={{ __html: person.organization }}
          />
        )}
      </div>
    </div>
  </div>
)

const Section = ({ heading, anchor, people, showOrg, hideTitle }) => (
  <>
    <div className="title-heading1 mb60" id={anchor}>
      <h3 className="mb10">{heading}</h3>
    </div>
    <div className="row pb60">
      {people.map((p, i) => (
        <PersonCard
          key={`${anchor}-${i}`}
          person={p}
          showOrg={showOrg}
          hideTitle={hideTitle}
        />
      ))}
    </div>
  </>
)

const PeopleList = () => {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    loadPeople()
      .then((payload) => {
        if (!cancelled) setData(payload)
      })
      .catch((e) => {
        if (!cancelled) setError(e)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="container pt90">
      <div className="row">
        <div className="col-lg-12">
          {error && <div>Unable to load people.</div>}
          {!error && !data && <div>&nbsp;</div>}
          {data &&
            SECTIONS.map((s) => (
              <Section
                key={s.key}
                heading={s.heading}
                anchor={s.anchor}
                people={data[s.key] || []}
                showOrg={s.showOrg}
                hideTitle={s.hideTitle}
              />
            ))}
        </div>
      </div>
    </div>
  )
}

export default PeopleList
