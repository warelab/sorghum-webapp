import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * PublicationBrowser
 *
 * Props:
 *  - publications: Array<Publication>
 *  - tagLabels: Record<string|number, string>   // tagId -> label
 *  - pageSize?: number
 *
 * Publication fields expected:
 *  - id (number|string)
 *  - title.rendered (string) OR title (string)
 *  - paper_authors (string)
 *  - journal (string)
 *  - publication_date (YYYY-MM-DD) OR date/date_gmt
 *  - doi (string)
 *  - keywords (string)
 *  - abstract (string)
 *  - source_url (string)
 *  - link (string)
 *  - tags (number[] | string[])
 */
export default function PublicationBrowser({
                                             publications = [],
                                             tagLabels = {},
                                             pageSize = 25,
                                           }) {
  // ---------------------------
  // UI state
  // ---------------------------
  const [q, setQ] = useState("");
  const [selectedTags, setSelectedTags] = useState(() => new Set());
  const [dateFrom, setDateFrom] = useState(""); // yyyy-mm-dd
  const [dateTo, setDateTo] = useState(""); // yyyy-mm-dd

  // Multi-sort: array of { key, dir }
  // keys: "date" | "title" | "journal" | "authors"
  const [sorts, setSorts] = useState([{ key: "date", dir: "desc" }]);

  const [tagsExpanded, setTagsExpanded] = useState(false);
  const [page, setPage] = useState(1);

  // Per-paper abstract expansion state (collapsed by default)
  const [expandedAbstracts, setExpandedAbstracts] = useState(() => new Set());
  const [copiedForId, setCopiedForId] = useState(null);
  const copiedTimerRef = useRef(null);

  // Reset to page 1 when filters change
  useEffect(() => {
    setPage(1);
  }, [q, dateFrom, dateTo, sorts, selectedTags.size]);

  // Cleanup copy timer
  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    };
  }, []);

  // ---------------------------
  // Helpers
  // ---------------------------
  const stripHtml = (html) => {
    if (!html) return "";
    try {
      const doc = new DOMParser().parseFromString(html, "text/html");
      return (doc.body?.textContent || "").trim();
    } catch {
      return String(html).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    }
  };

  const norm = (s) => (s == null ? "" : String(s)).toLowerCase();

  const getTitle = (p) => stripHtml(p?.title?.rendered ?? p?.title ?? "");
  const getAuthors = (p) => p?.paper_authors ?? "";
  const getJournal = (p) => p?.journal ?? "";
  const getDoi = (p) => p?.doi ?? "";
  const getKeywords = (p) => p?.keywords ?? "";
  const getAbstract = (p) => p?.abstract ?? "";
  const getUrl = (p) => p?.source_url || p?.link || "";

  const getTagIds = (p) =>
    Array.isArray(p?.tags) ? p.tags.map((t) => String(t)) : [];

  const parsePubDate = (p) => {
    const raw = p?.publication_date || p?.date || p?.date_gmt || "";
    if (!raw) return null;
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  };

  const fmtDate = (d) => {
    if (!d) return "";
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const getTagLabel = (tagId) => {
    const key = String(tagId);
    return tagLabels?.[key] ?? tagLabels?.[Number(key)] ?? `Tag #${key}`;
  };

  const toggleAbstract = (paperId) => {
    const key = String(paperId);
    setExpandedAbstracts((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const collapseAllAbstracts = () => setExpandedAbstracts(new Set());

  const copyText = async (paperId, text) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedForId(String(paperId));
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopiedForId(null), 1200);
    } catch {
      window.prompt("Copy abstract:", text);
    }
  };

  // ---------------------------
  // Preprocess: apply search + date filters (NO journal/author filters)
  // ---------------------------
  const preTagFiltered = useMemo(() => {
    const qn = norm(q).trim();
    const fromD = dateFrom ? new Date(dateFrom + "T00:00:00") : null;
    const toD = dateTo ? new Date(dateTo + "T23:59:59") : null;

    return publications.filter((p) => {
      const d = parsePubDate(p);
      if (fromD && (!d || d < fromD)) return false;
      if (toD && (!d || d > toD)) return false;

      if (qn) {
        const blob = [
          getTitle(p),
          getAuthors(p),
          getJournal(p),
          getDoi(p),
          getKeywords(p),
          getAbstract(p),
        ]
          .join(" ")
          .toLowerCase();
        if (!blob.includes(qn)) return false;
      }

      return true;
    });
  }, [publications, q, dateFrom, dateTo]);

  // ---------------------------
  // Apply tag filter first
  // ---------------------------
  const tagFiltered = useMemo(() => {
    const selected = selectedTags;
    let rows = preTagFiltered;

    if (selected.size > 0) {
      // AND semantics: must include all selected tags
      rows = rows.filter((p) => {
        const tags = getTagIds(p);
        for (const s of selected) {
          if (!tags.includes(String(s))) return false;
        }
        return true;
      });
    }

    return rows;
  }, [preTagFiltered, selectedTags]);

  // ---------------------------
  // Tag tally based on CURRENT paper set
  //  - only tags with count >= 1
  //  - selected tags float to top
  // ---------------------------
  const tagCounts = useMemo(() => {
    const counts = new Map();

    for (const p of tagFiltered) {
      for (const tid of getTagIds(p)) {
        counts.set(tid, (counts.get(tid) || 0) + 1);
      }
    }

    const items = Array.from(counts.entries())
      .map(([tagId, count]) => ({
        tagId,
        count,
        label: getTagLabel(tagId),
      }))
      .filter((x) => x.count > 0);

    items.sort((a, b) => {
      const aSel = selectedTags.has(String(a.tagId)) ? 1 : 0;
      const bSel = selectedTags.has(String(b.tagId)) ? 1 : 0;

      if (aSel !== bSel) return bSel - aSel;
      if (a.count !== b.count) return b.count - a.count;
      return a.label.localeCompare(b.label);
    });

    return items;
  }, [tagFiltered, tagLabels, selectedTags]);

  const visibleTagItems = useMemo(() => {
    if (tagsExpanded) return tagCounts;
    return tagCounts.slice(0, 20);
  }, [tagCounts, tagsExpanded]);

  // ---------------------------
  // Apply sorting after filtering
  // ---------------------------
  const filteredAndSorted = useMemo(() => {
    const rows = tagFiltered;
    const sortSpec = Array.isArray(sorts) && sorts.length ? sorts : [];
    if (!sortSpec.length) return rows;

    const withIndex = rows.map((p, idx) => ({ p, idx }));
    const cmpStr = (a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" });

    const keyFn = {
      date: (p) => parsePubDate(p)?.getTime() ?? -Infinity,
      title: (p) => getTitle(p),
      journal: (p) => getJournal(p),
      authors: (p) => getAuthors(p),
    };

    withIndex.sort((A, B) => {
      for (const s of sortSpec) {
        const dir = s.dir === "asc" ? 1 : -1;
        const k = s.key;
        if (!keyFn[k]) continue;

        const av = keyFn[k](A.p);
        const bv = keyFn[k](B.p);

        let diff = 0;
        if (typeof av === "number" && typeof bv === "number") diff = av - bv;
        else diff = cmpStr(String(av ?? ""), String(bv ?? ""));

        if (diff !== 0) return diff * dir;
      }
      return A.idx - B.idx;
    });

    return withIndex.map((x) => x.p);
  }, [tagFiltered, sorts]);

  // Collapse abstracts when any filters/sorts change (optional UX)
  useEffect(() => {
    collapseAllAbstracts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, dateFrom, dateTo, sorts, selectedTags.size]);

  // ---------------------------
  // Pagination
  // ---------------------------
  const total = filteredAndSorted.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);

  const pageItems = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredAndSorted.slice(start, start + pageSize);
  }, [filteredAndSorted, safePage, pageSize]);

  // ---------------------------
  // Actions
  // ---------------------------
  const toggleTag = (tagId) => {
    const key = String(tagId);
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const clearAll = () => {
    setQ("");
    setSelectedTags(new Set());
    setDateFrom("");
    setDateTo("");
    setSorts([{ key: "date", dir: "desc" }]);
    setTagsExpanded(false);
    setPage(1);
    collapseAllAbstracts();
  };

  const addSort = (key) => {
    setSorts((prev) => {
      if (prev.some((s) => s.key === key)) return prev;
      return [...prev, { key, dir: "asc" }];
    });
  };

  const toggleSortDir = (key) => {
    setSorts((prev) =>
      prev.map((s) =>
        s.key === key ? { ...s, dir: s.dir === "asc" ? "desc" : "asc" } : s
      )
    );
  };

  const removeSort = (key) => {
    setSorts((prev) => prev.filter((s) => s.key !== key));
  };

  // ---------------------------
  // Render
  // ---------------------------
  return (
    <div style={styles.wrap}>
      {/*<div style={styles.header}>*/}

      {/*</div>*/}

      <div style={styles.grid}>
        {/* Left: filters */}
        <aside style={styles.sidebar}>
          <div style={styles.titleBlock}>
            {/*<div style={styles.h1}>Publications</div>*/}
            <div style={styles.sub}>
              &nbsp;Showing <b>{total}</b> result{total === 1 ? "" : "s"}
              <button style={styles.clearBtn} onClick={clearAll} type="button">
                Clear filters
              </button>
            </div>
          </div>
          <div style={styles.panel}>
            <div style={styles.panelTitle}>Search</div>
            <input
              style={styles.input}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Title, authors, journal, keywords, abstract, DOI…"
            />
          </div>

          <div style={styles.panel}>
            <div style={styles.panelTitle}>Publication date</div>
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={styles.label}>From</div>
                <input
                  style={styles.dateInput}
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                />
              </div>
              <div style={{ flex: 1 }}>
                <div style={styles.label}>To</div>
                <input
                  style={styles.dateInput}
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div style={styles.panel}>
            <div style={styles.panelTitle}>Tags</div>

            {tagCounts.length === 0 ? (
              <div style={styles.muted}>No tags in current results.</div>
            ) : (
              <>
                <div style={styles.tagList}>
                  {visibleTagItems.map((t) => {
                    const active = selectedTags.has(String(t.tagId));
                    return (
                      <button
                        key={t.tagId}
                        type="button"
                        onClick={() => toggleTag(t.tagId)}
                        style={{
                          ...styles.tagChip,
                          ...(active ? styles.tagChipActive : null),
                        }}
                        title={`Filter by ${t.label}`}
                      >
                        <span>{t.label}</span>
                        <span
                          style={{
                            ...styles.tagCount,
                            ...(active ? styles.tagCountActive : null),
                          }}
                        >
                          {t.count}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {tagCounts.length > 20 && (
                  <button
                    type="button"
                    style={styles.linkBtn}
                    onClick={() => setTagsExpanded((v) => !v)}
                  >
                    {tagsExpanded ? "Show fewer" : `Show all (${tagCounts.length})`}
                  </button>
                )}

                {selectedTags.size > 0 && (
                  <button
                    type="button"
                    style={{ ...styles.linkBtn, marginTop: 8 }}
                    onClick={() => setSelectedTags(new Set())}
                  >
                    Clear tag filters ({selectedTags.size})
                  </button>
                )}
              </>
            )}
          </div>

          <div style={styles.panel}>
            <div style={styles.panelTitle}>Sort</div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {["date", "title", "journal", "authors"].map((k) => (
                <button
                  key={k}
                  type="button"
                  style={styles.smallBtn}
                  onClick={() => addSort(k)}
                  disabled={sorts.some((s) => s.key === k)}
                  title="Add sort key"
                >
                  + {k}
                </button>
              ))}
            </div>

            <div style={{ marginTop: 10 }}>
              {sorts.length === 0 ? (
                <div style={styles.muted}>No sorts applied.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {sorts.map((s, idx) => (
                    <div key={s.key} style={styles.sortRow}>
                      <div style={{ fontWeight: 600 }}>
                        {idx + 1}. {s.key}
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          type="button"
                          style={styles.smallBtn}
                          onClick={() => toggleSortDir(s.key)}
                          title="Toggle direction"
                        >
                          {s.dir === "asc" ? "↑ asc" : "↓ desc"}
                        </button>
                        <button
                          type="button"
                          style={styles.smallBtnDanger}
                          onClick={() => removeSort(s.key)}
                          title="Remove sort key"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div style={styles.panel}>
            <div style={styles.panelTitle}>Display</div>
            <div style={styles.muted}>
              Abstracts are collapsed by default. Click “Abstract” on a paper to expand.
            </div>
          </div>
        </aside>

        {/* Right: results */}
        <main style={styles.main}>
          <div style={styles.pagerTop}>
            <Pager page={safePage} totalPages={totalPages} onPage={setPage} />
          </div>

          <div style={styles.results}>
            {pageItems.map((p) => {
              const title = getTitle(p);
              const authors = getAuthors(p);
              const j = getJournal(p);
              const d = parsePubDate(p);
              const doi = getDoi(p);
              const url = getUrl(p);
              const tags = getTagIds(p);

              const abstractText = stripHtml(getAbstract(p));
              const hasAbstract = Boolean(abstractText && abstractText.trim().length);
              const isOpen = expandedAbstracts.has(String(p.id));
              const copied = copiedForId === String(p.id);

              return (
                <article key={String(p.id)} style={styles.card}>
                  <div style={styles.cardTitle}>{title}</div>

                  {authors ? <div style={styles.authors}>{authors}</div> : null}

                  <div style={styles.metaRow}>
                    {d ? (
                      <span style={styles.date}>
                        <b>Published:</b>&nbsp;{fmtDate(d)} in
                      </span>
                    ) : null}
                    {j ? <em>{j}</em> : null}
                    {doi ? (
                      <span style={styles.metaPill}>
                        DOI:{" "}
                        <a
                          href={`https://doi.org/${doi}`}
                          target="_blank"
                          rel="noreferrer"
                          style={styles.a}
                        >
                          {doi}
                        </a>
                      </span>
                    ) : null}
                    {url && (
                      <span style={styles.metaPill}>
                        <a href={url} target="_blank" rel="noreferrer" style={styles.a}>
                          PubMed
                        </a>
                      </span>
                    )}
                  </div>

                  {tags.length > 0 ? (
                    <div style={styles.inlineTags}>
                      {tags.slice(0, 12).map((tid) => (
                        <button
                          key={tid}
                          type="button"
                          onClick={() => toggleTag(tid)}
                          style={{
                            ...styles.inlineTagChip,
                            ...(selectedTags.has(String(tid))
                              ? styles.inlineTagChipActive
                              : null),
                          }}
                          title="Toggle tag filter"
                        >
                          {getTagLabel(tid)}
                        </button>
                      ))}
                      {tags.length > 12 ? (
                        <span style={styles.muted}>+{tags.length - 12} more</span>
                      ) : null}
                    </div>
                  ) : null}

                  {hasAbstract ? (
                    <div style={styles.abstractWrap}>
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => toggleAbstract(p.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            toggleAbstract(p.id);
                          }
                        }}
                        aria-expanded={isOpen}
                        style={styles.abstractHeaderRow}
                        title={isOpen ? "Click to hide abstract" : "Click to show abstract"}
                      >
                        <div style={styles.abstractHeaderLeft}>
                          <span style={styles.caret}>{isOpen ? "▼" : "▶"}</span>
                          <span style={styles.abstractHeaderText}>Abstract</span>
                          {!isOpen ? (
                            <span style={styles.abstractPreview}>
                              {abstractText.length > 140
                                ? abstractText.slice(0, 140) + "…"
                                : abstractText}
                            </span>
                          ) : null}
                        </div>

                        <div style={styles.abstractHeaderRight}>
                          {isOpen ? (
                            <button
                              type="button"
                              style={styles.copyBtn}
                              onClick={(e) => {
                                e.stopPropagation();
                                copyText(p.id, abstractText);
                              }}
                              title="Copy abstract to clipboard"
                            >
                              {copied ? "Copied!" : "Copy"}
                            </button>
                          ) : (
                            <span style={styles.mutedSmall}>Click to expand</span>
                          )}
                        </div>
                      </div>

                      <div
                        style={{
                          ...styles.abstractBodyOuter,
                          ...(isOpen ? styles.abstractBodyOuterOpen : null),
                        }}
                        aria-hidden={!isOpen}
                      >
                        <div style={styles.abstractBodyInner}>{abstractText}</div>
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>

          <div style={styles.pagerBottom}>
            <Pager page={safePage} totalPages={totalPages} onPage={setPage} />
          </div>
        </main>
      </div>
    </div>
  );
}

function Pager({ page, totalPages, onPage }) {
  const canPrev = page > 1;
  const canNext = page < totalPages;

  const jump = (p) => onPage(Math.min(Math.max(1, p), totalPages));

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <button
        type="button"
        onClick={() => jump(1)}
        disabled={!canPrev}
        style={styles.smallBtn}
      >
        « First
      </button>
      <button
        type="button"
        onClick={() => jump(page - 1)}
        disabled={!canPrev}
        style={styles.smallBtn}
      >
        ‹ Prev
      </button>

      <div style={{ minWidth: 120, textAlign: "center" }}>
        Page <b>{page}</b> / {totalPages}
      </div>

      <button
        type="button"
        onClick={() => jump(page + 1)}
        disabled={!canNext}
        style={styles.smallBtn}
      >
        Next ›
      </button>
      <button
        type="button"
        onClick={() => jump(totalPages)}
        disabled={!canNext}
        style={styles.smallBtn}
      >
        Last »
      </button>
    </div>
  );
}

// Minimal inline styles (swap for CSS modules/Tailwind if desired)
const styles = {
  wrap: {
    fontFamily:
      'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"',
    color: "#111",
    marginTop: 10,
  },
  header: {
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 12,
  },
  titleBlock: { display: "flex", flexDirection: "column", gap: 4 },
  h1: { fontSize: 22, fontWeight: 800 },
  sub: { color: "#444" },

  grid: {
    display: "grid",
    gridTemplateColumns: "320px 1fr",
    gap: 14,
    alignItems: "start",
  },
  sidebar: {
    position: "sticky",
    top: 12,
    alignSelf: "start",
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  panel: {
    border: "1px solid #e6e6e6",
    borderRadius: 12,
    padding: 12,
    background: "#fff",
    boxShadow: "0 1px 8px rgba(0,0,0,0.04)",
  },
  panelTitle: { fontWeight: 800, marginBottom: 8 },
  label: { fontSize: 12, color: "#555", marginBottom: 4 },
  input: {
    width: "100%",
    border: "1px solid #ddd",
    borderRadius: 10,
    padding: "10px 10px",
    outline: "none",
  },
  dateInput: {
    width: "90%",
    border: "1px solid #ddd",
    borderRadius: 10,
    padding: "5px 5px",
    outline: "none",
  },

  tagList: { display: "flex", flexWrap: "wrap", gap: 8 },
  tagChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    border: "1px solid #ddd",
    background: "#fafafa",
    borderRadius: 999,
    padding: "6px 10px",
    cursor: "pointer",
    fontSize: 13,
  },
  tagChipActive: {
    border: "1px solid #111",
    background: "#111",
    color: "#fff",
  },
  tagCount: {
    fontSize: 12,
    padding: "2px 8px",
    borderRadius: 999,
    background: "rgba(0,0,0,0.08)",
  },
  tagCountActive: { background: "rgba(255,255,255,0.22)" },

  main: { minWidth: 0 },
  pagerTop: { display: "flex", justifyContent: "flex-end", marginBottom: 10 },
  pagerBottom: { display: "flex", justifyContent: "flex-end", marginTop: 10 },
  results: { display: "flex", flexDirection: "column", gap: 10 },
  card: {
    border: "1px solid #e6e6e6",
    borderRadius: 14,
    padding: 12,
    background: "#fff",
    boxShadow: "0 1px 10px rgba(0,0,0,0.04)",
  },
  cardTitle: { fontWeight: 900, fontSize: 16, marginBottom: 8 },
  a: { color: "#111", textDecoration: "none" },
  metaRow: { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 },
  metaPill: {
    fontSize: 12,
    border: "1px solid #eee",
    borderRadius: 999,
    padding: "4px 8px",
    background: "#fafafa",
  },
  authors: { color: "#333", marginBottom: 10, fontStyle: "italic" },
  inlineTags: { display: "flex", gap: 8, flexWrap: "wrap" },
  inlineTagChip: {
    border: "1px solid #ddd",
    borderRadius: 999,
    padding: "5px 10px",
    background: "#fff",
    cursor: "pointer",
    fontSize: 12,
  },
  inlineTagChipActive: {
    background: "#111",
    color: "#fff",
    border: "1px solid #111",
  },

  sortRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    border: "1px solid #eee",
    borderRadius: 10,
    padding: "8px 10px",
    background: "#fafafa",
  },

  // Abstract UX polish styles
  abstractWrap: { marginTop: 10 },
  abstractHeaderRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: 10,
    alignItems: "center",
    border: "1px solid #eee",
    borderRadius: 12,
    background: "#fafafa",
    padding: "10px 10px",
    cursor: "pointer",
    userSelect: "none",
  },
  abstractHeaderLeft: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
    flex: 1,
  },
  caret: { width: 16, textAlign: "center", fontWeight: 800 },
  abstractHeaderText: { fontWeight: 800, whiteSpace: "nowrap" },
  abstractPreview: {
    color: "#444",
    fontSize: 13,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  abstractHeaderRight: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
  },
  mutedSmall: { color: "#666", fontSize: 12 },
  copyBtn: {
    border: "1px solid #ddd",
    borderRadius: 10,
    padding: "7px 10px",
    background: "#fff",
    cursor: "pointer",
    fontSize: 13,
  },
  abstractBodyOuter: {
    maxHeight: 0,
    opacity: 0,
    overflow: "hidden",
    transition: "max-height 220ms ease, opacity 180ms ease",
  },
  abstractBodyOuterOpen: { maxHeight: 420, opacity: 1 },
  abstractBodyInner: {
    marginTop: 8,
    padding: 10,
    border: "1px solid #eee",
    borderRadius: 12,
    background: "#fff",
    color: "#333",
    lineHeight: 1.45,
    fontSize: 13,
    whiteSpace: "pre-wrap",
  },

  smallBtn: {
    border: "1px solid #ddd",
    borderRadius: 10,
    padding: "7px 10px",
    background: "#fff",
    cursor: "pointer",
  },
  smallBtnDanger: {
    border: "1px solid #ffb3b3",
    borderRadius: 10,
    padding: "7px 10px",
    background: "#fff5f5",
    cursor: "pointer",
  },
  linkBtn: {
    marginTop: 10,
    border: "none",
    background: "transparent",
    padding: 0,
    cursor: "pointer",
    textDecoration: "underline",
    color: "#111",
    textAlign: "left",
  },
  clearBtn: {
    border: "1px solid #ddd",
    borderRadius: 10,
    padding: "7px 10px",
    background: "#fff",
    cursor: "pointer",
    marginLeft: "10px",
  },
  muted: { color: "#666", fontSize: 13 },
};
