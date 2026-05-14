import React from 'react'

// Shared Bootstrap-styled pagination.
//
// Props:
//   page         current 1-indexed page
//   totalPages   total page count (1 disables rendering)
//   onNavigate   (page:number) => void — required
//   buildHref    optional (page:number) => string — when present the items
//                render as real <a href> so middle-click / right-click work.
//                Without it, items use href="#" + preventDefault.
//   windowSize   number of numeric buttons around current page (default 5)
//   className    extra <nav> classes
//
// Produces: « Previous | 1 ... 4 5 [6] 7 8 ... 24 | Next »
const Pagination = ({
  page,
  totalPages,
  onNavigate,
  buildHref,
  windowSize = 5,
  className = '',
}) => {
  if (!totalPages || totalPages <= 1) return null

  const clamped = Math.max(1, Math.min(totalPages, page))
  const half = Math.floor(windowSize / 2)
  let start = Math.max(1, clamped - half)
  let end = Math.min(totalPages, start + windowSize - 1)
  start = Math.max(1, Math.min(start, end - windowSize + 1))

  const pages = []
  if (start > 1) {
    pages.push(1)
    if (start > 2) pages.push('…')
  }
  for (let i = start; i <= end; i++) pages.push(i)
  if (end < totalPages) {
    if (end < totalPages - 1) pages.push('…')
    pages.push(totalPages)
  }

  const Item = ({ target, label, disabled, active, key }) => {
    const cls = `page-item${disabled ? ' disabled' : ''}${active ? ' active' : ''}`
    const href = !disabled && target && buildHref ? buildHref(target) : '#'
    const onClick = (e) => {
      e.preventDefault()
      if (disabled) return
      if (target && target !== clamped) onNavigate(target)
    }
    return (
      <li className={cls} key={key}>
        <a className="page-link" href={href} onClick={onClick} aria-current={active ? 'page' : undefined}>
          {label}
        </a>
      </li>
    )
  }

  return (
    <nav aria-label="Pagination" className={className}>
      <ul className="pagination justify-content-center mb0">
        <Item
          key="prev"
          target={clamped - 1}
          label="Previous"
          disabled={clamped <= 1}
        />
        {pages.map((p, i) =>
          p === '…' ? (
            <li className="page-item disabled" key={`gap-${i}`}>
              <span className="page-link">…</span>
            </li>
          ) : (
            <Item
              key={`p-${p}`}
              target={p}
              label={String(p)}
              active={p === clamped}
            />
          )
        )}
        <Item
          key="next"
          target={clamped + 1}
          label="Next"
          disabled={clamped >= totalPages}
        />
      </ul>
    </nav>
  )
}

export default Pagination
