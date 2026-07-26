// Guided tour of the gene search interface, built on react-joyride v3.
//
// v3 notes that matter here (its API differs from the v2 examples you'll find
// online): `Joyride` is a NAMED export, defaults live in the `options` prop
// rather than `styles.options`, and each step may carry an async `before` hook
// that the tour awaits (showing a loader) before anchoring. That hook is what
// lets a step switch on a result view, run a search or load an expression study
// and wait for the target to mount — no controlled stepIndex bookkeeping.
//
// We use the `useJoyride` hook rather than the `<Joyride>` component so the tour
// element can be rendered alongside a table of contents that starts it at a
// chosen chapter, and so `controls` is available to the event handler.
//
// The tour is offered from the contents list in the Help / Demo view (rendered
// there through a portal), or by loading /genes?tour=1.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useJoyride, ACTIONS, EVENTS, STATUS } from 'react-joyride'
import { connect } from 'redux-bundler-react'
import buildSteps, { TOUR_SECTIONS } from './tourSteps'
import './tour.css'

const TOUR_PARAM = 'tour'

// Above the fixed navbar (1030) and the fixed footer (1031) on the genes page.
const TOUR_Z_INDEX = 2000

/**
 * Table of contents, rendered into the Help / Demo view.
 *
 * react-joyride has no built-in contents component; this is just a list of
 * chapters that starts the tour at a given step. It mounts through a portal into
 * the results column's Help / Demo section, which gramene-search marks with
 * data-tour-view="help".
 */
const TourContents = ({ onStart }) => (
  <div className="gene-search-tour-toc">
    <h4 className="gene-search-tour-toc-title">Take the tour</h4>
    <p className="gene-search-tour-toc-intro">
      A guided walk through the search interface. Start at the beginning, or jump
      to whichever part you need — each chapter sets up the search it needs.
    </p>
    <ol className="gene-search-tour-toc-list">
      {TOUR_SECTIONS.map((s) => (
        <li key={s.start}>
          <button type="button" onClick={() => onStart(s.start - 1)}>
            <span className="gene-search-tour-toc-name">{s.title}</span>
            <span className="gene-search-tour-toc-blurb">{s.blurb}</span>
          </button>
        </li>
      ))}
    </ol>
  </div>
)

const GeneSearchTourCmp = (props) => {
  // Steps read state through this ref, never through the props captured when the
  // tour started — a step's `before` hook may run many seconds later, by which
  // point views have mounted and searches have landed.
  const propsRef = useRef(props)
  propsRef.current = props

  const [steps, setSteps] = useState([])
  const [stepIndex, setStepIndex] = useState(0)
  const [running, setRunning] = useState(false)
  const [helpMount, setHelpMount] = useState(null)

  const handleEvent = useCallback((data) => {
    const { type, status, action, index } = data
    if (status === STATUS.FINISHED || status === STATUS.SKIPPED) {
      setRunning(false)
      return
    }
    // Controlled mode: we own the index, so advance it ourselves once a step is
    // done. A step whose feature isn't present in this deployment, whose view
    // never mounted, or whose `before` hook threw or timed out shouldn't
    // dead-end the tour — treat it like a completed step and move on. Without
    // the ERROR case a slow setup leaves the tour showing nothing, with no way
    // forward.
    if (
      type === EVENTS.STEP_AFTER ||
      type === EVENTS.TARGET_NOT_FOUND ||
      type === EVENTS.ERROR
    ) {
      setStepIndex(index + (action === ACTIONS.PREV ? -1 : 1))
    }
  }, [])

  const { Tour } = useJoyride({
    steps,
    continuous: true,
    run: running,
    // Controlled mode. The table of contents has to be able to open the tour at
    // an arbitrary chapter, and neither controls.start(n) nor initialStepIndex
    // survives the re-render that delivers the steps — owning the index here is
    // the only deterministic option.
    stepIndex,
    onEvent: handleEvent,
    options: {
      primaryColor: '#a03e34',
      textColor: '#333',
      zIndex: TOUR_Z_INDEX,
      showProgress: true,
      buttons: ['back', 'primary', 'skip', 'close'],
      spotlightPadding: 6,
      spotlightRadius: 4,
      // Open each step's tooltip straight away. Without this Joyride shows a
      // beacon (a dot the visitor must click) for the first step of a run —
      // invisible on the full tour, whose first step is placement:'center', but
      // it silently stalls every chapter started from the table of contents.
      skipBeacon: true,
      // The sidebar and results are independent scroll panes on this page, so
      // each step scrolls its own pane in `before` (see tourUtils) and Joyride
      // must not also try to scroll the window.
      skipScroll: true,
      // Views mount asynchronously after their toggle action, and some steps
      // run a search or load an expression study first.
      targetWaitTimeout: 15000,
      beforeTimeout: 45000,
      overlayColor: 'rgba(0, 0, 0, 0.45)'
    },
    locale: { back: 'Back', close: 'Close', last: 'Done', next: 'Next', skip: 'Skip tour' }
  })

  /**
   * Start the tour, optionally from a later chapter.
   *
   * A chapter jump slices the step list rather than starting the tour at a
   * non-zero index: Joyride would run the target step's `before` hook but never
   * render its tooltip, whereas starting at index 0 is reliable. Slicing also
   * gives the chapter an honest progress count ("1 of 11") and stops Back from
   * walking into steps whose setup never ran. Chapter openers each ensure their
   * own result set (see ensurePathwaySearch), so a sliced tour stands alone.
   */
  const start = useCallback(
    (fromIndex = 0) => {
      const all = buildSteps(() => propsRef.current)
      setSteps(fromIndex > 0 ? all.slice(fromIndex) : all)
      setStepIndex(0)
      setRunning(true)
    },
    []
  )

  // Autostart from ?tour=1 and strip the param so a reload doesn't replay it.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    if (url.searchParams.get(TOUR_PARAM)) {
      url.searchParams.delete(TOUR_PARAM)
      window.history.replaceState({}, '', url.toString())
      start(0)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // gramene-search renders the [data-tour-view] wrapper for every view whether
  // it is on or off — only the header and body are conditional. So the portal
  // target existing is not enough: gate on the view actually being switched on,
  // or the contents list would sit in the results column with Help / Demo off.
  const viewsOn = props.grameneViewsOn
  const helpViewOn = !!(viewsOn && viewsOn.has && viewsOn.has('help'))

  // Portals append, which would drop the contents list below the view's own
  // content. Mount into a node we insert directly after the view header instead,
  // so the list reads first for keyboard and screen-reader users too — a CSS
  // `order` would move it visually while leaving it last in the tab order.
  const mountRef = useRef(null)

  useEffect(() => {
    const detach = () => {
      const node = mountRef.current
      if (node && node.parentNode) node.parentNode.removeChild(node)
      mountRef.current = null
    }

    if (!helpViewOn) {
      detach()
      setHelpMount(null)
      return undefined
    }

    let cancelled = false
    const attach = () => {
      if (cancelled) return
      const section = document.querySelector('[data-tour-view="help"]')
      if (!section) return
      let node = mountRef.current
      if (!node || !node.isConnected) {
        node = document.createElement('div')
        node.className = 'gene-search-tour-mount'
        mountRef.current = node
      }
      const header = section.querySelector('.gramene-view-header')
      const anchor = header ? header.nextSibling : section.firstChild
      if (node.parentNode !== section || node.previousSibling !== header) {
        section.insertBefore(node, anchor)
      }
      setHelpMount(node)
    }

    attach()
    // The view's body can mount a tick after its wrapper; re-place if so.
    const t = setTimeout(attach, 400)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [helpViewOn, viewsOn])

  // Take our node with us if the tour unmounts.
  useEffect(
    () => () => {
      const node = mountRef.current
      if (node && node.parentNode) node.parentNode.removeChild(node)
      mountRef.current = null
    },
    []
  )

  const toc = useMemo(
    () => (helpViewOn && helpMount ? createPortal(<TourContents onStart={start} />, helpMount) : null),
    [helpViewOn, helpMount, start]
  )

  // Renders nothing where it sits in the sidebar — the tour is offered by the
  // contents list in the Help / Demo view (portaled) and by /genes?tour=1.
  return (
    <>
      {toc}
      {Tour}
    </>
  )
}

export default connect(
  'doClearGrameneFilters',
  'doAcceptGrameneSuggestion',
  'doChangeSuggestionsQuery',
  'doChangeSuggestionsTab',
  'doClearSuggestions',
  'doToggleGrameneView',
  'doToggleFacetCounts',
  'doExpandGeneDetail',
  'doSetHomologyViewer',
  'doSetExprVizActiveTaxon',
  'doSetExprVizFields',
  'doFetchExprVizData',
  'doSetExprVizVizMode',
  'doSetExprVizBrushes',
  'doSetOntologyEnrichmentActiveTaxon',
  'selectGrameneViewsOn',
  'selectGrameneFilters',
  'selectGrameneSearch',
  'selectExprViz',
  'selectExpressionStudies',
  'selectExpressionSamples',
  'selectTargetTaxonId',
  GeneSearchTourCmp
)
