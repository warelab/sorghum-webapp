// WordPress stores non-ASCII slug characters percent-encoded (e.g. an omega
// becomes "%cf%89"), but the slug arriving from the URL is already decoded
// ("ω"). Normalize both to a percent-decoded, lowercased form before comparing
// so an encoded stored slug still matches its decoded URL (and vice versa).
export function normSlug(s) {
  if (s == null) return ''
  try {
    return decodeURIComponent(String(s)).toLowerCase()
  } catch (_) {
    // malformed percent-escape — fall back to a plain lowercase compare
    return String(s).toLowerCase()
  }
}

// True when two slugs refer to the same resource, ignoring percent-encoding
// and case differences.
export function slugsMatch(a, b) {
  return normSlug(a) === normSlug(b)
}
