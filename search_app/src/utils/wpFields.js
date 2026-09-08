// Shape-tolerant readers for WordPress/Pods fields.
//
// Pods returns a repeatable field as an array when it holds several values,
// but as a bare scalar when it holds one -- and which of the two you get can
// change when the field is reconfigured in the CMS. Code that assumes an
// array breaks the moment that happens: `/projects` went down with "Unable to
// load projects." because normalize() called `(raw.pi || []).join(',')` and
// every record had come back with `pi` as a plain string, so the TypeError
// rejected the whole load.
//
// Always read a maybe-repeatable field through these.

/**
 * Normalize a maybe-repeatable field to an array.
 * Falsy (missing, '', false) -> []; a scalar -> [scalar]; an array -> itself.
 */
export function stringList(value) {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

/**
 * Join a maybe-repeatable field into a display string.
 * Returns '' when the field is absent.
 */
export function joinField(value, separator = ',') {
  return stringList(value).join(separator)
}
