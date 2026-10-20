// SorghumBase's gene-search tour: the site-specific search intro and wording,
// composed with the shared chapters from gramene-search-tour.
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

import {
  createTourKit,
  resultSetSteps,
  geneSteps,
  refineSteps,
  viewsSteps,
  expressionSteps,
  setToolsSteps,
  revealTarget,
  waitForElement,
  waitFor,
  sleep
} from 'gramene-search-tour'

// The pathway the tour searches for, and the gene inside it we drill into.
const SEARCH_TERM = 'jasmonic'
const PATHWAY_LABEL = 'Jasmonic acid biosynthesis'
const EXAMPLE_GENE = 'SORBI_3006G095600'
const EXAMPLE_GENE_NAME = 'MSD2'

// The filter the tour's search produces. Applied directly when a visitor jumps
// into the middle of the tour from the contents list, so every chapter has the
// result set its steps assume.
const PATHWAY_SUGGESTION = {
  fq_field: 'pathways__ancestors',
  fq_value: '1119332',
  name: PATHWAY_LABEL,
  category: 'Plant Reactome: Pathway'
}

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

export function closeSearchBox() {
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

export default function buildSteps(getProps) {
  const kit = createTourKit(getProps, {
    prefix: 'sorghumbase',
    search: PATHWAY_SUGGESTION,
    // Sb bicolor BTx623 v3, the sorghum anchor. (It used to fall back to
    // 4558001, which is Sb verticilliflorum 353, a non-anchor wild relative.)
    fallbackTaxon: 4558006
  })

  return [
    // ── 1. Run the search, for real ───────────────────────────────────
    {
      chapter: { title: 'Run a search', blurb: 'Find genes by pathway, not by ID' },
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
        kit.act('doClearGrameneFilters')
        kit.act('doClearSuggestions')
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
        `press / — to open the search box from any page on the site.`,
      // Joyride runs with skipScroll, so a step that does not scroll its own
      // target leaves the tooltip anchored off-screen when the visitor started
      // the tour from part-way down the page.
      before: async () => revealTarget('.search-open', { block: 'center' })
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
        kit.act('doChangeSuggestionsTab', 'gramene')
        kit.act('doChangeSuggestionsQuery', SEARCH_TERM)
        await waitForElement('#sorghumbase-search-input', { timeout: 8000 })
        // Let the suggestions land first — the highlight is sized to the input
        // and the panel together, so measuring before it opens would clip it.
        await waitFor(() => kit.findSuggestion(PATHWAY_LABEL), { timeout: 20000 })
        searchAreaBox()
        return revealTarget(() => searchAreaBox(), { block: 'center' })
      }
    },
    {
      target: '.search-suggestions',
      placement: 'bottom',
      title: 'Suggestions, grouped and counted',
      content:
        `As you type, matching terms are grouped by what they are — pathways, ` +
        `ontology terms, gene names — and each one shows how many genes it would ` +
        `find. That number tells you whether a term is broad or specific before you ` +
        `commit to it.`,
      before: async () => {
        // Wait for the suggestion fetch to land, not just the panel to mount.
        await waitFor(() => kit.findSuggestion(PATHWAY_LABEL), { timeout: 20000 })
        return revealTarget('.search-suggestions', { block: 'center' })
      }
    },
    {
      target: () => kit.findSuggestion(PATHWAY_LABEL),
      placement: 'bottom',
      title: 'Pick the pathway',
      // The suggestions list is its own scroll pane and this row is often below
      // its fold, so without this the tooltip anchors off-screen and the overlay
      // leaves no way to scroll to it.
      before: async () =>
        revealTarget(() => kit.findSuggestion(PATHWAY_LABEL), { block: 'center' }),
      content:
        `Under Plant Reactome: Pathway, "${PATHWAY_LABEL}" matches 32 genes across ` +
        `the pan-genome. Choosing it turns the term into a search filter — that's ` +
        `what we'll do next.`
    },

    ...resultSetSteps(kit, {
      chapter: { title: 'Read the results', blurb: 'Filters, distribution and the gene list' },
      filterLabel: PATHWAY_LABEL,
      // Perform the click the previous step pointed at; ensureSearch applies
      // the filter directly if it didn't happen (jumped here).
      enter: async () => {
        const btn = kit.findSuggestion(PATHWAY_LABEL)
        if (btn) btn.click()
        closeSearchBox()
      },
      copy: {
        neighborhood: {
          content:
            `Neighborhood takes the ten genes either side of each match along the ` +
            `chromosome — genomic context rather than homology. Picking the selected ` +
            `option again clears it, which is what happens as we leave this step, so ` +
            `the rest of the tour runs on the plain pathway genes.`
        }
      }
    }),

    ...geneSteps(kit, {
      chapter: { title: `One gene: ${EXAMPLE_GENE_NAME}`, blurb: 'Evidence tabs, pathways and the family tree' },
      gene: EXAMPLE_GENE,
      copy: {
        card: {
          title: `${EXAMPLE_GENE_NAME} is one of these genes`,
          content:
            `${EXAMPLE_GENE} (${EXAMPLE_GENE_NAME.toLowerCase()}, "similar to Lipoxygenase") is one of ` +
            `the sorghum genes in this pathway — lipoxygenases catalyse the first ` +
            `committed step of jasmonic acid biosynthesis. Let's look at the evidence ` +
            `behind it.`
        },
        tabs: {
          content:
            `Each gene carries a row of tabs: Germplasm (accessions with a ` +
            `protein-truncating variant), Sequences, Location, Expression, Homology, ` +
            `Pathways, Papers and Xrefs. A tab is only offered when that evidence ` +
            `exists for the gene.`
        },
        pathways: {
          content:
            `Pathways is what put ${EXAMPLE_GENE_NAME} in this result set. ` +
            `The tree on the left lists every Plant Reactome pathway and reaction the ` +
            `gene takes part in; the diagram shows the selected one with the gene ` +
            `flagged.`
        }
      }
    }),

    ...refineSteps(kit, {
      chapter: { title: 'Refine the set', blurb: 'Count your results by category' }
    }),

    ...viewsSteps(kit, {
      chapter: { title: 'Views', blurb: 'Read the same genes another way' }
    }),

    ...expressionSteps(kit, {
      chapter: { title: 'Expression', blurb: 'Heatmap, parallel coordinates, brushing' },
      copy: {
        exprViz: {
          content:
            `Expression data is per genome, so this view opens on a tab per genome in ` +
            `your results. We've picked Sorghum bicolor BTx623 — the reference — and ` +
            `now need to choose which samples to plot.`
        }
      }
    }),

    ...setToolsSteps(kit, {
      chapter: {
        title: 'Enrichment, lists & export',
        blurb: 'Over-represented terms, your own gene lists, and taking data with you'
      },
      copy: {
        enrichment: {
          content:
            `Enrichment asks which GO, Plant Ontology or Trait Ontology terms turn up ` +
            `in your results more often than chance would predict, with fold enrichment ` +
            `and an adjusted p-value for each. Pick the species on the left — we've ` +
            `selected sorghum rather than whichever genome happened to be first.`
        }
      }
    })
  ]
}
