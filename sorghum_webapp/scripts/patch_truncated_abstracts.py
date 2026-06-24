#!/usr/bin/env python3
"""Patch already-published scientific_paper posts whose abstracts were
truncated by the pymed inline-element bug.

Background
----------
pymed's helpers.getContent extracted AbstractText via ElementTree's .text
attribute. That attribute returns only the characters BEFORE the first
child element, so any abstract containing inline formatting (<sup>, <sub>,
<i>, <b>, <u>) was silently cut off at the first such tag and concatenated
without labels for structured (BACKGROUND/METHODS/...) abstracts. The fix
in utilities/pubmedIDpull.py walks the XML with itertext(); this script
retroactively patches posts that were enriched-and-published BEFORE that
fix landed.

The bug has a precise signature: a post is truncated by THIS bug iff its
current `abstract` field equals exactly what pymed's broken getContent
would have produced for the same PubMed XML. Any manual edit makes the
comparison fail and the post is skipped. The same conservative check is
applied to `content`: we only patch it if we can find the buggy abstract
substring inside the existing content.raw.

Two passes
----------
  scan   - walk the wp_cache publications snapshot + fetch PubMed XML in
           batches; for each PMID where the buggy and corrected abstracts
           differ AND the cached `abstract` field matches the buggy
           reconstruction verbatim, record an entry in a manifest JSON.
           NO traffic to WordPress -- we trust the wp_cache snapshot.

  apply  - read the manifest, for each entry GET the WP post (with
           context=edit) to grab content.raw, then PATCH `abstract`
           always and `content` only when the buggy abstract appears
           verbatim inside content.raw. --dry-run shows the same checks
           without sending the PATCH.

Usage
-----
  # Phase 1 (no WP traffic):
  python patch_truncated_abstracts.py scan --out manifest.json

  # Phase 2 (needs auth):
  SB_WP_USERNAME=... SB_WP_PASSWORD=... \\
    python patch_truncated_abstracts.py apply --manifest manifest.json --dry-run
  SB_WP_USERNAME=... SB_WP_PASSWORD=... \\
    python patch_truncated_abstracts.py apply --manifest manifest.json
"""

import argparse
import json
import logging
import os
import sys
import time
import xml.etree.ElementTree as ET

import requests
from requests.auth import HTTPBasicAuth

EFETCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"
DEFAULT_CACHE_URL = "https://www.sorghumbase.org/api/wp_cache/publications"
DEFAULT_WP_BASE = "https://content.sorghumbase.org/wordpress/index.php/wp-json/wp/v2"
PUBMED_BATCH = 100

logger = logging.getLogger("patch_abstracts")


# ---------------------------------------------------------------------------
# Abstract reconstruction (mirrors pymed's old behavior + our fix)
# ---------------------------------------------------------------------------

def _buggy_abstract(article_xml):
    """Reproduce what pymed's getContent('.//AbstractText') used to return:
    newline-joined .text of each AbstractText, no inline content, no labels."""
    parts = []
    for at in article_xml.findall(".//AbstractText"):
        if at.text is not None:
            parts.append(at.text)
    return "\n".join(parts)


def _correct_abstract(article_xml):
    """Walk every text node under each AbstractText, preserving inline
    content. Prefix labeled abstracts with '{Label}: '. Matches the fix in
    utilities/pubmedIDpull.py exactly."""
    parts = []
    for at in article_xml.findall(".//AbstractText"):
        text = "".join(at.itertext()).strip()
        if not text:
            continue
        label = at.get("Label")
        parts.append(f"{label}: {text}" if label else text)
    return "\n".join(parts)


# ---------------------------------------------------------------------------
# PubMed batch fetch
# ---------------------------------------------------------------------------

def fetch_pubmed_articles(pmids, batch_size=PUBMED_BATCH, sleep=0.34):
    """Yield (pmid, <PubmedArticle> Element). Batches of ~100 IDs per
    request. Default sleep keeps us under NCBI's 3 req/s ceiling for
    unauthenticated callers."""
    pmids = [p for p in pmids if p]
    batches = (len(pmids) + batch_size - 1) // batch_size
    for i in range(0, len(pmids), batch_size):
        batch = pmids[i:i + batch_size]
        logger.info(
            "efetch batch %d/%d (%d ids)",
            i // batch_size + 1, batches, len(batch),
        )
        resp = requests.get(
            EFETCH_URL,
            params={
                "db": "pubmed",
                "id": ",".join(batch),
                "rettype": "xml",
                "retmode": "xml",
            },
            timeout=60,
        )
        resp.raise_for_status()
        root = ET.fromstring(resp.content)
        for article in root.findall(".//PubmedArticle"):
            pmid_elem = article.find(".//PMID")
            if pmid_elem is None or not pmid_elem.text:
                continue
            yield pmid_elem.text.strip(), article
        if sleep:
            time.sleep(sleep)


# ---------------------------------------------------------------------------
# Content patching
# ---------------------------------------------------------------------------

def _patch_content(content_raw, buggy, correct):
    """Substring-replace the buggy abstract within content_raw. Returns the
    patched string, or None if the buggy abstract isn't a verbatim substring
    of content (in which case content was edited beyond what we'd recognize
    and we leave it alone)."""
    if not content_raw or not buggy:
        return None
    if buggy in content_raw:
        return content_raw.replace(buggy, correct, 1)
    return None


# ---------------------------------------------------------------------------
# WP REST
# ---------------------------------------------------------------------------

def wp_get(wp_base, post_id, auth):
    """GET a single scientific_paper with context=edit so content.raw is
    returned. Returns None on 404 (post deleted)."""
    url = f"{wp_base.rstrip('/')}/scientific_paper/{post_id}"
    resp = requests.get(url, params={"context": "edit"}, auth=auth, timeout=60)
    if resp.status_code == 404:
        return None
    resp.raise_for_status()
    return resp.json()


def wp_patch(wp_base, post_id, fields, auth):
    url = f"{wp_base.rstrip('/')}/scientific_paper/{post_id}"
    resp = requests.post(url, json=fields, auth=auth, timeout=60)
    if not resp.ok:
        detail = ""
        try:
            j = resp.json()
            detail = f" {j.get('code') or ''} {j.get('message') or ''}"
        except ValueError:
            detail = " " + (resp.text or "")[:200]
        raise RuntimeError(f"{resp.status_code} {resp.reason}{detail}")
    return resp.json()


# ---------------------------------------------------------------------------
# scan
# ---------------------------------------------------------------------------

def cmd_scan(args):
    # No WP traffic at scan time -- we trust the wp_cache snapshot.
    logger.info("fetching publications snapshot from %s", args.cache_url)
    resp = requests.get(args.cache_url, timeout=180)
    resp.raise_for_status()
    pubs = resp.json()
    logger.info("got %d publications", len(pubs))

    # Build (wp_id, pubmed_id, abstract) tuples. The Pods `abstract` field
    # comes back as a top-level string on the wp_cache snapshot.
    pubs_by_pmid = {}
    for p in pubs:
        pmid = (p.get("pubmed_id") or "").strip()
        wp_id = p.get("id")
        if not (pmid and wp_id):
            continue
        # Defensive: if two posts share a PMID (shouldn't, but be careful),
        # keep both -- we'll evaluate each.
        pubs_by_pmid.setdefault(pmid, []).append({
            "wp_id": wp_id,
            "slug": p.get("slug") or "",
            "abstract": (p.get("abstract") or "").strip(),
        })
    total_with_pmid = sum(len(v) for v in pubs_by_pmid.values())
    logger.info(
        "%d publications carry a pubmed_id (%d unique PMIDs)",
        total_with_pmid, len(pubs_by_pmid),
    )

    # Pull XML for the unique PMIDs.
    unique_pmids = sorted(pubs_by_pmid)
    logger.info("fetching PubMed XML for %d unique PMIDs", len(unique_pmids))
    xml_by_pmid = {}
    for pmid, article in fetch_pubmed_articles(unique_pmids):
        xml_by_pmid[pmid] = article
    logger.info("PubMed returned XML for %d/%d PMIDs", len(xml_by_pmid), len(unique_pmids))

    # Match signature: cached abstract == buggy reconstruction AND
    # buggy != correct (i.e. PubMed has inline children we'd now preserve).
    confirmed = []
    skipped_no_signature = 0
    skipped_edited = 0
    skipped_no_xml = 0
    for pmid, posts in pubs_by_pmid.items():
        article = xml_by_pmid.get(pmid)
        if article is None:
            skipped_no_xml += len(posts)
            continue
        buggy = _buggy_abstract(article)
        correct = _correct_abstract(article)
        if not buggy or not correct or buggy == correct:
            skipped_no_signature += len(posts)
            continue
        for post in posts:
            if post["abstract"] != buggy.strip():
                skipped_edited += 1
                continue
            confirmed.append({
                "wp_id": post["wp_id"],
                "pubmed_id": pmid,
                "slug": post["slug"],
                "old_abstract_len": len(buggy),
                "new_abstract_len": len(correct),
                "buggy_abstract": buggy,
                "new_abstract": correct,
            })

    logger.info(
        "scan summary: %d confirmed truncated | %d edited (skipped) | "
        "%d not affected by this bug | %d PMIDs not returned by PubMed",
        len(confirmed), skipped_edited, skipped_no_signature, skipped_no_xml,
    )

    with open(args.out, "w") as f:
        json.dump({
            "version": 2,
            "wp_base": args.wp_base,
            "entries": confirmed,
        }, f, indent=2)
    print(f"wrote {len(confirmed)} entries to {args.out}")


# ---------------------------------------------------------------------------
# apply
# ---------------------------------------------------------------------------

def cmd_apply(args):
    auth = _auth_from_env(required=True)

    with open(args.manifest) as f:
        manifest = json.load(f)
    entries = manifest["entries"]
    wp_base = args.wp_base or manifest.get("wp_base") or DEFAULT_WP_BASE
    if args.limit:
        entries = entries[:args.limit]
    logger.info(
        "%s %d entries from %s against %s",
        "dry-running" if args.dry_run else "applying",
        len(entries), args.manifest, wp_base,
    )

    succeeded = 0
    skipped_drift = 0
    failed = []
    for e in entries:
        wp_id = e["wp_id"]
        pmid = e["pubmed_id"]
        delta = e["new_abstract_len"] - e["old_abstract_len"]

        # Re-fetch the post for two reasons:
        #   1. Get content.raw so we can do the substring patch on content.
        #   2. Confirm the abstract STILL matches the buggy reconstruction
        #      -- the snapshot we scanned may have aged out since.
        try:
            post = wp_get(wp_base, wp_id, auth)
        except Exception as ex:
            logger.warning("wp_id=%s pmid=%s GET failed: %s", wp_id, pmid, ex)
            failed.append({"wp_id": wp_id, "pubmed_id": pmid, "error": f"GET: {ex}"})
            continue
        if post is None:
            logger.info("wp_id=%s pmid=%s gone (404); skipping", wp_id, pmid)
            failed.append({"wp_id": wp_id, "pubmed_id": pmid, "error": "404"})
            continue
        live_abstract = (post.get("abstract") or "").strip()
        if live_abstract != e["buggy_abstract"].strip():
            # Someone (admin, an earlier run of this script) edited the
            # abstract since the scan. Don't clobber.
            skipped_drift += 1
            logger.info(
                "wp_id=%s pmid=%s abstract no longer matches buggy signature; skipping",
                wp_id, pmid,
            )
            continue
        content_obj = post.get("content") or {}
        content_raw = content_obj.get("raw") or ""
        new_content = _patch_content(content_raw, e["buggy_abstract"], e["new_abstract"])

        fields = {"abstract": e["new_abstract"]}
        if new_content is not None:
            fields["content"] = new_content
            content_note = "content rebuilt"
        else:
            content_note = "content unchanged (buggy abstract not found in content.raw)"

        msg = (f"wp_id={wp_id} pmid={pmid} "
               f"abstract +{delta}c ({e['old_abstract_len']} -> {e['new_abstract_len']}); "
               f"{content_note}")
        if args.dry_run:
            print(f"[dry-run] {msg}")
            continue
        try:
            wp_patch(wp_base, wp_id, fields, auth)
            logger.info("PATCHED %s", msg)
            succeeded += 1
        except Exception as ex:
            logger.warning("FAILED %s: %s", msg, ex)
            failed.append({"wp_id": wp_id, "pubmed_id": pmid, "error": f"PATCH: {ex}"})
        if args.sleep:
            time.sleep(args.sleep)

    if args.dry_run:
        return
    print(f"done: {succeeded} patched, {skipped_drift} skipped (drift), {len(failed)} failed")
    if failed:
        err_path = args.manifest.replace(".json", "") + ".errors.json"
        with open(err_path, "w") as f:
            json.dump(failed, f, indent=2)
        print(f"errors written to {err_path}")


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def _auth_from_env(required=True):
    u = os.environ.get("SB_WP_USERNAME")
    p = os.environ.get("SB_WP_PASSWORD")
    if u and p:
        return HTTPBasicAuth(u, p)
    if required:
        sys.exit("SB_WP_USERNAME and SB_WP_PASSWORD must be set")
    return None


def main():
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    sub = parser.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("scan", help="identify truncated abstracts, write manifest")
    s.add_argument("--cache-url", default=DEFAULT_CACHE_URL)
    s.add_argument("--wp-base", default=DEFAULT_WP_BASE,
                   help="recorded in the manifest for the apply phase")
    s.add_argument("--out", default="abstract_patch_manifest.json")
    s.set_defaults(func=cmd_scan)

    a = sub.add_parser("apply", help="apply patches from manifest")
    a.add_argument("--manifest", default="abstract_patch_manifest.json")
    a.add_argument("--wp-base", default="",
                   help="overrides wp_base recorded in the manifest")
    a.add_argument("--dry-run", action="store_true",
                   help="print what would change without sending PATCH requests")
    a.add_argument("--sleep", type=float, default=0.5,
                   help="seconds between PATCHes (default 0.5)")
    a.add_argument("--limit", type=int, default=0,
                   help="stop after N entries (0 = no limit)")
    a.set_defaults(func=cmd_apply)

    args = parser.parse_args()
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )
    args.func(args)


if __name__ == "__main__":
    main()
