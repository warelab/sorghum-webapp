// A conference_person's institutions as [{post_title}], for display.
//
// `affiliation` is a plain string in WordPress ("Texas Tech University");
// older payloads had it as a list of strings or organization dicts.
// `organization` is a list of organization dicts on the conference_people
// resource, but only bare integer IDs when embedded in an abstract's
// presenting_author, and those carry no name. Prefer the affiliation text,
// then any named organizations.
function toOrgs(raw) {
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

export function presenterOrgs(presenter) {
  if (!presenter) return []
  const aff = presenter.affiliation
  const fromAffiliation = toOrgs(typeof aff === 'string' ? [aff] : aff)
  return fromAffiliation.length ? fromAffiliation : toOrgs(presenter.organization)
}
