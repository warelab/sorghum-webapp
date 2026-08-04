// Step definitions for the SorghumBase gene-search tour.
//
// The tour opens by actually performing a search rather than describing one:
// it clicks the spyglass, types "jasmonic", waits for the suggestions to load
// and accepts the "Jasmonic acid biosynthesis" pathway. Everything after that
// runs against those 32 genes — including MSD2 (SORBI_3006G095600), which is a
// member of the pathway and carries the Homology evidence we demonstrate.
//
// Content follows the "Using the genes search interface" quick guide
// (/guides -> Genomic Resources -> search-interface), extended to the features
// that post-date it: the TBrowse views, the Refine facet panel and the newer
// result Views.
//
// Every step is anchored either to a class rendered explicitly in
// gramene-search / search_app source, or to a function that resolves the
// element at run time (react-joyride v3 accepts a function target). Any step
// needing UI that is collapsed, switched off or not yet fetched brings it up in
// its own async `before` hook — v3 awaits that promise behind a loader, so a
// step never fires at a target that hasn't mounted.

import { revealTarget, waitForElement, waitFor, sleep, callIfPresent } from './tourUtils'

// The pathway the tour searches for, and the gene inside it we drill into.
const SEARCH_TERM = 'jasmonic'
const PATHWAY_LABEL = 'Jasmonic acid biosynthesis'
export const EXAMPLE_GENE = 'SORBI_3006G095600'
const EXAMPLE_GENE_NAME = 'msd2'

// The filter the tour's search produces. Applied directly when a visitor jumps
// into the middle of the tour from the contents list, so every chapter has the
// result set its steps assume.
const PATHWAY_SUGGESTION = {
  fq_field: 'pathways__ancestors',
  fq_value: '1119332',
  name: PATHWAY_LABEL,
  category: 'Plant Reactome: Pathway'
}

/**
 * Chapters, for the table of contents. `start` is a 1-based step number; the
 * step it names must be able to stand on its own (see ensurePathwaySearch),
 * because the contents list can jump straight to it.
 */
export const TOUR_SECTIONS = [
  { start: 1, title: 'Run a search', blurb: 'Find genes by pathway, not by ID' },
  { start: 6, title: 'Read the results', blurb: 'Filters, distribution and the gene list' },
  { start: 12, title: `One gene: ${EXAMPLE_GENE_NAME.toUpperCase()}`, blurb: 'Evidence tabs and the family tree' },
  { start: 16, title: 'Refine the set', blurb: 'Count your results by category' },
  { start: 18, title: 'Views', blurb: 'Read the same genes another way' },
  { start: 20, title: 'Expression', blurb: 'Heatmap, parallel coordinates, brushing' },
  { start: 24, title: 'Enrichment & export', blurb: 'Over-represented terms, and taking data with you' }
]

// --- DOM helpers for the live search demo -----------------------------------

const SEARCH_BOX_ID = 'sorghumbase-searchbar-parent'

/** Open the navbar search box the way a visitor does — by clicking the spyglass. */
function openSearchBox() {
  const spyglass = document.querySelector('.search-open')
  if (spyglass) spyglass.click()
  // The click handler lives in the site's assan.custom.js (jQuery). Add the
  // class directly too, so the tour still works anywhere that script isn't
  // loaded (and it's a no-op when the handler already did it).
  const box = document.getElementById(SEARCH_BOX_ID)
  if (box && !box.classList.contains('search-visible')) box.classList.add('search-visible')
}

const SEARCH_AREA_ID = 'gene-search-tour-search-area'

function closeSearchBox() {
  const box = document.getElementById(SEARCH_BOX_ID)
  if (box) box.classList.remove('search-visible')
  const area = document.getElementById(SEARCH_AREA_ID)
  if (area && area.parentNode) area.parentNode.removeChild(area)
}

/**
 * A measurement-only stand-in covering the whole open search overlay: the input
 * row *and* the suggestions panel beneath it.
 *
 * Spotlighting the input alone lights an 80px strip and leaves the attached tab
 * bar and results dimmed, so the search widget reads as cut in half. The two
 * parts are separately positioned with no common box (#sorghumbase-searchbar is
 * 0px tall because its children are absolutely positioned), so there is no real
 * element to point at — hence this invisible one, sized to their union.
 */
function searchAreaBox() {
  const input = document.querySelector('#sorghumbase-search-input')
  if (!input) return null
  const rects = [input.getBoundingClientRect()]
  const suggestions = document.querySelector('.search-suggestions')
  if (suggestions) {
    const r = suggestions.getBoundingClientRect()
    if (r.height > 0) rects.push(r)
  }
  const top = Math.min(...rects.map((r) => r.top))
  const bottom = Math.max(...rects.map((r) => r.bottom))
  const left = Math.min(...rects.map((r) => r.left))
  const right = Math.max(...rects.map((r) => r.right))

  let el = document.getElementById(SEARCH_AREA_ID)
  if (!el) {
    el = document.createElement('div')
    el.id = SEARCH_AREA_ID
    el.setAttribute('aria-hidden', 'true')
    el.style.cssText = 'position:fixed;pointer-events:none;z-index:-1'
    document.body.appendChild(el)
  }
  el.style.top = `${top}px`
  el.style.left = `${left}px`
  el.style.width = `${Math.max(0, right - left)}px`
  el.style.height = `${Math.max(0, bottom - top)}px`
  return el
}

/**
 * The suggestion button for a given label. Buttons render as
 * `<Button id="{group}-{doc}">{display_name} <Badge/>…</Button>` inside
 * `#gramene-suggestion` groups (gramene-search/src/components/suggestions.js),
 * so match on the leading display name — "Jasmonic acid biosynthesis" and
 * "Jasmonic acid signaling" are otherwise easy to confuse.
 */
function findSuggestion(label) {
  const buttons = document.querySelectorAll('.search-suggestions button')
  for (const b of buttons) {
    const text = (b.textContent || '').replace(/\s+/g, ' ').trim()
    if (text.indexOf(label) === 0) return b
  }
  return null
}

/** The result card for one gene id. */
function findGeneCard(geneId) {
  const cards = document.querySelectorAll('.result-gene')
  for (const c of cards) {
    if ((c.textContent || '').indexOf(geneId) !== -1) return c
  }
  return null
}

/**
 * An element inside Expression visualization's *visible* genome tab.
 *
 * react-bootstrap Tabs mount every pane, so `.exprviz-hm-container` and
 * `.exprviz-pc-container` also exist inside the hidden panes of the other
 * genomes at 0x0. Matching one of those makes a step look ready and then fail
 * to anchor, which silently skipped the heatmap. Scope to `.exprviz-view` too —
 * the navbar's suggestions widget uses `.tab-pane` as well.
 */
function exprVizActive(selector) {
  const pane = document.querySelector('.exprviz-view .tab-pane.active')
  return pane ? pane.querySelector(selector) : null
}

/** Genome-level taxon ids are species*1000+n; study metadata is keyed by species. */
function speciesTaxonId(tid) {
  const n = +tid
  return n > 1000000 ? Math.floor(n / 1000) : n
}

/**
 * `getProps` returns the tour component's latest props. Two things matter here:
 * redux-bundler-react's connect passes selector *values* (grameneViewsOn,
 * exprViz, …) rather than the selectX functions, and those values change as the
 * app works — so every hook has to read them fresh at call time rather than
 * closing over a snapshot taken when the tour started.
 */
export default function buildSteps(getProps) {
  // Action creators are stable, so destructuring them once is safe.
  const {
    doClearGrameneFilters,
    doAcceptGrameneSuggestion,
    doChangeSuggestionsQuery,
    doChangeSuggestionsTab,
    doClearSuggestions,
    doToggleGrameneView,
    doToggleFacetCounts,
    doExpandGeneDetail,
    doSetHomologyViewer,
    doSetExprVizActiveTaxon,
    doSetExprVizFields,
    doFetchExprVizData,
    doSetExprVizVizMode,
    doSetExprVizBrushes,
    doSetOntologyEnrichmentActiveTaxon
  } = getProps()

  // Sorghum BTx623 — the site's reference genome (config.targetTaxonId).
  const sorghumTaxon = () =>
    String(getProps().targetTaxonId || 4558001)

  const viewIsOn = (viewId) => {
    const on = getProps().grameneViewsOn
    return !!(on && on.has && on.has(viewId))
  }

  const ensureView = async (viewId, selector, timeout = 15000) => {
    if (!viewIsOn(viewId)) callIfPresent(doToggleGrameneView, viewId)
    return selector ? !!(await waitForElement(selector, { timeout })) : true
  }

  /** The Filters-panel node carrying the pathway term. */
  const pathwayFilterNode = () =>
    [...document.querySelectorAll('.gramene-filter-text')]
      .find(n => (n.textContent || '').indexOf(PATHWAY_LABEL) !== -1) || null

  /**
   * Open that filter's menu, where the "expand search" radios live. Idempotent —
   * clicking the node again would close it.
   */
  const openFilterMenu = async () => {
    if (!document.querySelector('.gramene-filter-menu')) {
      const node = pathwayFilterNode()
      if (!node) return null
      node.click()
      await waitForElement('.gramene-filter-menu', { timeout: 4000 }).catch(() => null)
    }
    return document.querySelector('.gramene-filter-menu')
  }

  /**
   * Click one of the expansion radios and wait for the re-run search to land, so
   * the gene count in the panel visibly changes before we move on. Re-picking the
   * radio that is already selected clears the expansion — that is how the
   * sequence returns to "none" at the end.
   */
  const pickExpansion = async (label, dwell = 1200) => {
    const menu = await openFilterMenu()
    if (!menu) return false
    const row = [...menu.querySelectorAll('.gramene-filter-menu-radio')]
      .find(li => (li.textContent || '').toLowerCase().indexOf(label) !== -1)
    if (!row) return false
    const before = (getProps().grameneSearch || {}).response
    const beforeCount = before ? before.numFound : null
    row.click()
    // Bounded: if a re-run is slow we move on rather than stalling the tour. The
    // clear in the caller's `finally` is what guarantees we don't leave the set
    // expanded, so a timeout here is survivable.
    await waitFor(
      () => {
        const r = getProps().grameneSearch
        const n = r && r.response ? r.response.numFound : null
        return n !== null && n !== beforeCount ? n : null
      },
      { timeout: 8000 }
    ).catch(() => null)
    // The store having the new count isn't enough — the panel only prints the
    // tally once the search reaches 'ready', and the whole point of this step is
    // watching that number move. Wait for it to be on screen before dwelling.
    await waitFor(
      () => (getProps().grameneFiltersStatus === 'ready' ? true : null),
      { timeout: 8000 }
    ).catch(() => null)
    // Hold each state long enough to be read.
    await sleep(dwell)
    return true
  }

  /**
   * Clear whichever expansion is selected, by re-picking the checked radio.
   * Reads the checked state rather than assuming which one was applied, so it
   * still works if the sequence above stopped part-way.
   */
  const clearExpansion = async () => {
    const menu = await openFilterMenu()
    if (!menu) return false
    const checked = [...menu.querySelectorAll('.gramene-filter-menu-radio')]
      .find(li => {
        const radio = li.querySelector('input[type=radio]')
        return radio && radio.checked
      })
    if (!checked) return true // nothing applied
    checked.click()
    await waitFor(
      () => {
        const on = document.querySelector('.gramene-filter-expansion')
        return on ? null : true
      },
      { timeout: 8000 }
    ).catch(() => null)
    return true
  }

  /**
   * Guarantee the pathway result set exists. Playing the tour linearly this is a
   * no-op — steps 1-6 already ran the search. It matters when a visitor jumps
   * to a later chapter from the contents list, where none of that has happened.
   */
  const ensurePathwaySearch = async () => {
    const filters = getProps().grameneFilters
    const already =
      filters && JSON.stringify(filters).indexOf(PATHWAY_SUGGESTION.fq_value) !== -1
    if (!already) {
      callIfPresent(doClearGrameneFilters)
      await sleep(150)
      callIfPresent(doAcceptGrameneSuggestion, PATHWAY_SUGGESTION)
    }
    // Wait on the search result itself, NOT on `.result-gene`: that markup only
    // exists while the Gene list view is switched on, and a chapter opened from
    // the contents list usually has every result view off — which stalled the
    // step for the full timeout before it did anything.
    const res = await waitFor(
      () => {
        const r = getProps().grameneSearch
        return r && r.response && r.response.numFound > 0 ? r : null
      },
      { timeout: 25000 }
    )
    return !!res
  }

  /**
   * Wait until Expression visualization has real content.
   *
   * ExprVizView renders `.exprviz-view` in every state — "Loading studies…",
   * "No expression studies for current results", and the populated view — so the
   * element existing says nothing about readiness. The genome tabs come from the
   * pivot facet, so wait for that instead.
   */
  const waitForExprVizReady = async (timeout = 30000) => {
    const ev = await waitFor(
      () => {
        const v = getProps().exprViz
        const pivot = v && v.pivot
        return pivot && pivot.status === 'ready' && Object.keys(pivot.data || {}).length
          ? v
          : null
      },
      { timeout }
    )
    return !!ev
  }

  /**
   * Drive Expression visualization to an actual plot. Left alone the view only
   * offers empty genome tabs, because it needs a genome, a set of sample columns
   * and an explicit "Load data" before it draws anything. This walks that whole
   * path for sorghum: pick the genome, take the first study that has samples,
   * turn its sample groups into `{study}_{group}__expr` field names, and load.
   *
   * Returns {taxon, study, fields} once rows have arrived, else null.
   */
  const loadExpressionForSorghum = async () => {
    const taxon = sorghumTaxon()
    const mounted = await ensureView('exprViz', '.exprviz-view', 20000)
    if (!mounted) return null
    if (!(await waitForExprVizReady())) return null
    callIfPresent(doSetExprVizActiveTaxon, taxon)
    // Start from a clean, comparable state. vizMode and brushes are remembered
    // per taxon, so a previous run of this chapter (which ends in parallel mode
    // with an axis brushed) would otherwise skip the heatmap step entirely —
    // the heatmap simply isn't rendered unless vizMode is 'heatmap' — and show
    // a pre-filtered plot before the step that explains filtering.
    callIfPresent(doSetExprVizVizMode, taxon, 'heatmap')
    callIfPresent(doSetExprVizBrushes, taxon, {})

    // Study/sample metadata is fetched once the view is on.
    const studies = await waitFor(() => {
      const all = getProps().expressionStudies
      const list = all && (all[taxon] || all[speciesTaxonId(taxon)])
      return list && list.length ? list : null
    }, { timeout: 25000 })
    if (!studies) return null

    const samplesByStudy = getProps().expressionSamples || {}
    const fieldsFor = (s) => {
      const samples = samplesByStudy[s._id]
      if (!samples || !samples.length) return []
      const firstPerGroup = {}
      samples.forEach((x) => { if (!firstPerGroup[x.group]) firstPerGroup[x.group] = x })
      return Object.keys(firstPerGroup).map(
        (g) => `${String(s._id).replace(/-/g, '_')}_${g}__expr`
      )
    }

    // Choose a study that actually demonstrates something. Taking whichever
    // study happens to be first is a poor demo — sorghum's first is a two-sample
    // comparison, while another is a 105-sample drought time course that would
    // swamp the plot. Prefer a baseline (tissue/development) study with a
    // readable number of samples; fall back to the first study with any.
    const candidates = studies
      .map((s) => ({ s, fields: fieldsFor(s) }))
      .filter((c) => c.fields.length)
    if (!candidates.length) return null
    const readable = candidates.filter((c) => c.fields.length >= 4 && c.fields.length <= 24)
    const baseline = readable.filter((c) => /baseline/i.test(c.s.type || ''))
    const pool = baseline.length ? baseline : (readable.length ? readable : candidates)
    const best = pool.reduce((a, b) => (b.fields.length > a.fields.length ? b : a))
    const study = best.s
    const fields = best.fields

    callIfPresent(doSetExprVizFields, taxon, fields)
    callIfPresent(doFetchExprVizData, taxon)

    const loaded = await waitFor(() => {
      const ev = getProps().exprViz
      const t = ev && ev.byTaxon && ev.byTaxon[taxon]
      return t && t.rows && t.rows.length ? t : null
    }, { timeout: 30000 })
    if (!loaded) return null
    return { taxon, study, fields }
  }

  // Remembers what loadExpressionForSorghum() loaded, so the parallel-coords
  // and brushing steps can reuse the same taxon/fields.
  let exprInfo = null

  /**
   * Brush one axis so that roughly the top third of genes stay selected.
   * Picking the cut by percentile rather than by half the value range keeps the
   * demo meaningful whatever the distribution looks like — expression is skewed,
   * so "top half of the range" can easily select one gene or all of them.
   */
  const brushTopOfFirstAxis = (taxon, fields) => {
    const ev = getProps().exprViz
    const t = ev && ev.byTaxon && ev.byTaxon[taxon]
    if (!t || !t.rows || !fields || !fields.length) return false
    const field = fields[0]
    const values = t.rows.map((r) => +r[field]).filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
    if (values.length < 3) return false
    const hi = values[values.length - 1]
    const lo = values[Math.floor(values.length * 0.66)]
    if (!(hi > lo)) return false
    callIfPresent(doSetExprVizBrushes, taxon, { [field]: [lo, hi] })
    return true
  }

  return [
    // ── 1. Run the search, for real ───────────────────────────────────
    {
      target: '#gene-search-ui',
      placement: 'center',
      title: 'Welcome to the gene search',
      content:
        `Let's run a real search together. We'll look for genes in the jasmonic ` +
        `acid biosynthesis pathway, then use that result set to walk through the ` +
        `interface — the gene evidence tabs, TBrowse, and the tools for working on ` +
        `a whole set of genes at once.`,
      before: async () => {
        // Start from a clean slate so the demo is the same every time.
        callIfPresent(doClearGrameneFilters)
        callIfPresent(doClearSuggestions)
        closeSearchBox()
        await sleep(200)
      }
    },
    {
      target: '.search-open',
      placement: 'bottom',
      title: 'Start with the spyglass',
      content:
        `Every search starts here. Click the spyglass in the menu bar — or just ` +
        `press / — to open the search box from any page on the site.`
    },
    {
      // The whole search overlay, so the highlight covers the input together
      // with the suggestions it produces rather than just the input's own row.
      target: () => searchAreaBox(),
      placement: 'bottom',
      title: 'Type what you are looking for',
      content:
        `Search accepts far more than gene IDs: gene names and synonyms, pathways, ` +
        `ontology terms and species all work, and none of it is case sensitive. ` +
        `We've typed "${SEARCH_TERM}".`,
      before: async () => {
        openSearchBox()
        // Gene suggestions live in the "Genes" tab; the site remembers whichever
        // tab you used last, so make sure we're on the right one.
        callIfPresent(doChangeSuggestionsTab, 'gramene')
        callIfPresent(doChangeSuggestionsQuery, SEARCH_TERM)
        await waitForElement('#sorghumbase-search-input', { timeout: 8000 })
        // Let the suggestions land first — the highlight is sized to the input
        // and the panel together, so measuring before it opens would clip it.
        await waitFor(() => findSuggestion(PATHWAY_LABEL), { timeout: 20000 })
        searchAreaBox()
      }
    },
    {
      target: '.search-suggestions',
      placement: 'bottom',
      title: 'Suggestions, grouped and counted',
      content:
        `As you type, matching terms are grouped by what they are — pathways, ` +
        `ontology terms, gene names — and each one shows how many genes it would ` +
        `find. That number tells you whether a term is worth pursuing before you ` +
        `commit to it.`,
      before: async () => {
        // Wait for the suggestion fetch to land, not just the panel to mount.
        await waitFor(() => findSuggestion(PATHWAY_LABEL), { timeout: 20000 })
      }
    },
    {
      target: () => findSuggestion(PATHWAY_LABEL),
      placement: 'bottom',
      title: 'Pick the pathway',
      content:
        `Under Plant Reactome: Pathway, "${PATHWAY_LABEL}" matches 32 genes across ` +
        `the pan-genome. Choosing it turns the term into a search filter — that's ` +
        `what we'll do next.`
    },

    // ── 2. The result set ─────────────────────────────────────────────
    {
      target: '.sorghumbase-sidebar',
      placement: 'right',
      title: 'The search panel',
      content:
        `Accepting a suggestion runs the search. The left panel is now the state of ` +
        `that search: how many genes matched, the filters that produced them, and ` +
        `the views available to explore them.`,
      before: async () => {
        // Perform the click the previous step pointed at, then wait for results.
        const btn = findSuggestion(PATHWAY_LABEL)
        if (btn) btn.click()
        closeSearchBox()
        // Applies the filter directly if the click didn't happen (jumped here).
        if (!(await ensurePathwaySearch())) return false
        // Later steps in this chapter point at the distribution and the gene
        // list, so make sure both views are actually on.
        await ensureView('taxTree', '.results-vis')
        await ensureView('list', '.result-gene')
        return revealTarget('.sorghumbase-sidebar', { block: 'start' })
      }
    },
    {
      target: '.sorghumbase-filter-container',
      placement: 'right',
      title: 'Filters build the query',
      content:
        `The term you accepted is now a filter, shown as "category | value". ` +
        `Filters combine with AND by default, so you can keep adding terms — a ` +
        `species, an expression class — to narrow the set. Click one to negate it, ` +
        `switch AND/OR, or remove it.`
    },
    {
      // The menu is opened by the `before` hook below, so point at it if it is
      // there and fall back to the panel if the filter could not be found.
      target: () =>
        document.querySelector('.gramene-filter-menu') ||
        document.querySelector('.sorghumbase-filter-container'),
      placement: 'right',
      title: 'Expand the search beyond the filter',
      content:
        `Filters only ever narrow a set. "Expand search" grows it along a ` +
        `biological relationship instead: the genes you matched become the ` +
        `starting point, and the result is those genes plus everything reachable ` +
        `from them. Watch the count as each option is picked — orthologs pulls in ` +
        `the equivalent genes in other genomes, paralogs stays inside this one, ` +
        `and neighborhood takes the ten genes either side along the chromosome. ` +
        `Picking the selected option again clears it, which is where we finish so ` +
        `the rest of the tour runs on the pathway genes.`,
      before: async () => {
        if (!(await ensurePathwaySearch())) return false
        await revealTarget('.sorghumbase-filter-container', { block: 'start' })
        if (!(await openFilterMenu())) return false
        // Demonstrate each in turn. The clear runs in `finally` so a slow or
        // failed re-run can't leave the tour expanded — every later step assumes
        // the plain pathway set.
        try {
          await pickExpansion('orthologs')
          await pickExpansion('paralogs')
          await pickExpansion('neighborhood')
        } finally {
          await clearExpansion()
        }
        return !!(await openFilterMenu())
      },
      after: async () => {
        // Backstop: the visitor can hit Next or Skip mid-demo, which aborts the
        // hook above before its `finally` has run.
        await clearExpansion()
        // Close the menu so it doesn't sit over the next step's target.
        const node = pathwayFilterNode()
        if (node && document.querySelector('.gramene-filter-menu')) node.click()
      }
    },
    {
      target: '.results-vis',
      placement: 'bottom',
      title: 'Where the matches are',
      content:
        `The top of the results shows how the matching genes are distributed across ` +
        `the species tree and along the genome — a quick read on whether a result ` +
        `set is broad or concentrated.`,
      before: async () => revealTarget('.results-vis', { block: 'start' })
    },
    {
      target: '.results-vis .tbrowse-zone-toggle',
      placement: 'bottom',
      title: 'TBrowse, over your results',
      content:
        `This is TBrowse, which composes "zones" side by side. Tree and Labels show ` +
        `which species carry these genes, Genes counts them per genome, and Genome ` +
        `distribution maps them onto the chromosomes.`,
      before: async () => revealTarget('.results-vis .tbrowse-zone-toggle', { block: 'start' })
    },
    {
      target: '.result-gene',
      placement: 'top',
      title: 'The gene list',
      content:
        `Below that is the paginated list of the 32 matching genes, each with its ` +
        `species, identifiers and description.`,
      before: async () => revealTarget('.result-gene', { block: 'start' })
    },

    // ── 3. One gene in the pathway: MSD2 ──────────────────────────────
    {
      target: () => findGeneCard(EXAMPLE_GENE),
      placement: 'top',
      title: `${EXAMPLE_GENE_NAME.toUpperCase()} is one of these genes`,
      content:
        `${EXAMPLE_GENE} (${EXAMPLE_GENE_NAME}, "similar to Lipoxygenase") is one of ` +
        `the sorghum genes in this pathway — lipoxygenases catalyse the first ` +
        `committed step of jasmonic acid biosynthesis. Let's look at the evidence ` +
        `behind it.`,
      before: async () => {
        await ensurePathwaySearch()
        await ensureView('list', '.result-gene')
        const card = await waitFor(() => findGeneCard(EXAMPLE_GENE), { timeout: 15000 })
        if (!card) return false
        return revealTarget(card, { block: 'start' })
      }
    },
    {
      target: () => {
        const card = findGeneCard(EXAMPLE_GENE)
        return card ? card.querySelector('.gene-detail-tabs') : null
      },
      placement: 'top',
      title: 'Evidence for each gene',
      content:
        `Each gene carries a row of tabs: Germplasm (accessions with a ` +
        `protein-truncating variant), Sequences, Location, Expression, Homology, ` +
        `Pathways, Papers and Xrefs. A tab is only offered when that evidence ` +
        `exists for the gene.`,
      before: async () => {
        const card = findGeneCard(EXAMPLE_GENE)
        if (!card) return false
        return revealTarget(card.querySelector('.gene-detail-tabs'), { block: 'center' })
      }
    },
    {
      target: () => {
        const card = findGeneCard(EXAMPLE_GENE)
        return card ? card.querySelector('.gene-genetree') : null
      },
      placement: 'top',
      title: 'TBrowse: the gene family tree',
      content:
        `Opening Homology draws the gene family tree in TBrowse. Protein domains ` +
        `are colour coded; click a triangle to expand or collapse a branch, or a ` +
        `gene name for its description, location and transcripts. When a search ` +
        `returns a single gene this tab opens on its own.`,
      before: async () => {
        callIfPresent(doExpandGeneDetail, { geneId: EXAMPLE_GENE, detail: 'homology' })
        // Homology remembers its viewer per gene; force TBrowse so the zone
        // buttons the next step points at are the ones that render.
        callIfPresent(doSetHomologyViewer, { geneId: EXAMPLE_GENE, viewer: 'tbrowse' })
        const tree = await waitFor(
          () => { const c = findGeneCard(EXAMPLE_GENE); return c && c.querySelector('.gene-genetree') },
          { timeout: 20000 }
        )
        if (!tree) return false
        return revealTarget(tree, { block: 'start', settle: 700 })
      }
    },
    {
      target: () => {
        const card = findGeneCard(EXAMPLE_GENE)
        return card ? card.querySelector('.gene-genetree .tbrowse-zone-toggle') : null
      },
      placement: 'bottom',
      title: 'Zones stack the evidence',
      content:
        `The same zone idea, now across the family: switch on MSA to zoom to the ` +
        `amino-acid alignment, Neighborhood to compare ±10 flanking genes, and ` +
        `Expression to read an organ-level heatmap for every gene in the tree.`,
      before: async () => {
        const zone = await waitFor(
          () => { const c = findGeneCard(EXAMPLE_GENE); return c && c.querySelector('.gene-genetree .tbrowse-zone-toggle') },
          { timeout: 15000 }
        )
        if (!zone) return false
        return revealTarget(zone, { block: 'start' })
      }
    },

    // ── 4. Tools for the whole set ────────────────────────────────────
    {
      target: '.sorghumbase-facet-container',
      placement: 'right',
      title: 'Refine: what else is in this set',
      content:
        `Refine counts your current results by category, so you can see what you ` +
        `have before narrowing further. It stays collapsed until you open it, and ` +
        `the counts always describe the search in front of you.`,
      before: async () => {
        await ensurePathwaySearch()
        callIfPresent(doToggleFacetCounts, true)
        // Counts arrive from a facet query — wait for real values.
        await waitForElement('.facet-count', { timeout: 20000 })
        return revealTarget('.sorghumbase-facet-container', { block: 'start' })
      }
    },
    {
      target: '.facet-count',
      placement: 'right',
      title: 'Click a count to filter',
      content:
        `Available data shows which evidence these genes carry; Expression class ` +
        `and TF family (GRASSIUS) group them biologically. The number beside each ` +
        `value is how many of your genes match it — click it and that becomes a ` +
        `new filter, ANDed onto the search.`,
      before: async () => revealTarget('.facet-count', { block: 'center' })
    },
    {
      target: '.gramene-view-container',
      placement: 'right',
      title: 'Views change the question',
      content:
        `The same result set can be read many ways. Toggle a view on to add it to ` +
        `the results column; click its name to jump straight to it.`,
      before: async () => {
        await ensurePathwaySearch()
        return revealTarget('.gramene-view-container', { block: 'start' })
      }
    },
    {
      target: '.attrtable-aggrid',
      placement: 'top',
      title: 'Gene attributes',
      content:
        `Gene attributes puts the whole result set in one sortable table — maximum ` +
        `expression, an organ-level heatmap, expression class, and the conditions ` +
        `that activate or repress each gene. Click any cell to filter on that value.`,
      before: async () => {
        const ok = await ensureView('attrTable', '.attrtable-aggrid')
        if (!ok) {
          if (viewIsOn('attrTable')) callIfPresent(doToggleGrameneView, 'attrTable')
          return false
        }
        return revealTarget('.attrtable-aggrid', { block: 'start', settle: 700 })
      },
    },
    {
      target: '.exprviz-view',
      placement: 'top',
      title: 'Expression visualization',
      content:
        `Expression data is per genome, so this view opens on a tab per genome in ` +
        `your results. We've picked Sorghum bicolor BTx623 — the reference — and ` +
        `now need to choose which samples to plot.`,
      before: async () => {
        await ensurePathwaySearch()
        const ok = await ensureView('exprViz', '.exprviz-view', 20000)
        if (!ok) return false
        // The view mounts instantly with a placeholder; wait for the genome tabs.
        if (!(await waitForExprVizReady())) return false
        callIfPresent(doSetExprVizActiveTaxon, sorghumTaxon())
        return revealTarget('.exprviz-view', { block: 'start', settle: 600 })
      }
    },
    {
      target: () => exprVizActive('.exprviz-hm-container'),
      placement: 'top',
      title: 'Pick samples, then load',
      content:
        `Choose fields to add sample columns — grouped by study, so you can take a ` +
        `whole experiment at once — then press Load data. We've loaded the first ` +
        `study: each row is a gene, each column a sample, and the colour is its ` +
        `expression level. Hover any cell for the sample's study, group and factors.`,
      before: async () => {
        const loaded = await loadExpressionForSorghum()
        if (!loaded) return false
        exprInfo = loaded
        const hm = await waitFor(() => exprVizActive('.exprviz-hm-container'), { timeout: 20000 })
        if (!hm) return false
        return revealTarget(hm, { block: 'start', settle: 800 })
      }
    },
    {
      target: () => exprVizActive('.exprviz-pc-container'),
      placement: 'top',
      title: 'Or read it as parallel coordinates',
      content:
        `The same data, drawn as one line per gene across an axis per sample. ` +
        `Genes that track together stay parallel; a gene that spikes in one ` +
        `condition crosses the others. Axes can be dragged to reorder them.`,
      before: async () => {
        const info = exprInfo
        if (!info) return false
        callIfPresent(doSetExprVizVizMode, info.taxon, 'parallel')
        const pc = await waitFor(() => exprVizActive('.exprviz-pc-container'), { timeout: 20000 })
        if (!pc) return false
        return revealTarget(pc, { block: 'start', settle: 800 })
      }
    },
    {
      target: () => exprVizActive('.exprviz-pc-container'),
      placement: 'top',
      title: 'Brush an axis to filter',
      content:
        `Drag along any axis to keep only the genes falling in that range — we've ` +
        `brushed the top half of the first sample. Brushes on several axes ` +
        `intersect, so you can isolate genes that are high in one condition and low ` +
        `in another, then turn that selection into a search filter.`,
      before: async () => {
        const info = exprInfo
        if (!info) return false
        brushTopOfFirstAxis(info.taxon, info.fields)
        await sleep(600)
        const pc = exprVizActive('.exprviz-pc-container')
        if (!pc) return false
        return revealTarget(pc, { block: 'start', settle: 600 })
      },
    },
    {
      target: '.oe-view',
      placement: 'top',
      title: 'Ontology Enrichment',
      content:
        `Enrichment asks which GO, Plant Ontology or Trait Ontology terms turn up ` +
        `in your results more often than chance would predict, with fold enrichment ` +
        `and an adjusted p-value for each. Pick the species on the left — we've ` +
        `selected sorghum rather than whichever genome happened to be first.`,
      before: async () => {
        await ensurePathwaySearch()
        const ok = await ensureView('ontologyEnrichment', '.oe-view', 20000)
        if (!ok) return false
        // Without this the view lands on whichever genome sorts first — often
        // Chlamydomonas — and shows nothing useful for a sorghum result set.
        callIfPresent(doSetOntologyEnrichmentActiveTaxon, sorghumTaxon())
        // Foreground and background counts are two more fetches; wait for the
        // panel to actually report them rather than guessing at a delay.
        await waitFor(
          () => {
            const panel = document.querySelector('.oe-panel')
            return panel && /Foreground:/.test(panel.textContent || '') ? panel : null
          },
          { timeout: 30000 }
        )
        return revealTarget('.oe-view', { block: 'start', settle: 700 })
      },
    },
    {
      target: '.exporter-view',
      placement: 'top',
      title: 'Data exporter',
      content:
        `Anything you can search, you can take with you: pick the fields you want ` +
        `and export the result set as a table. User Gene Lists (once you sign in) ` +
        `does the same for a set of genes you want to keep.`,
      before: async () => {
        const ok = await ensureView('export', '.exporter-view')
        if (!ok) return false
        return revealTarget('.exporter-view', { block: 'start', settle: 500 })
      },
    },
    {
      target: '.sorghumbase-auth-container',
      placement: 'right',
      title: 'Keep what you built',
      content:
        `Sign in to save a search — filters, views and open tabs — as a link you can ` +
        `share or return to. That's the tour; the quick guides under Guides go ` +
        `deeper on each tab.`,
      before: async () => revealTarget('.sorghumbase-auth-container', { block: 'start' })
    }
  ]
}
