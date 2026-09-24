#!/usr/bin/env python3
"""Backfill PubMed metadata on scientific_paper posts that were published
while pubmedIDpull's XML serialization was broken.

Background
----------
From the pymed swap (2026-05-18) until the fix in utilities/pubmedIDpull.py,
_refs_from_pymed serialized pymed's article XML with lxml.etree.tostring().
pymed parses with the stdlib xml.etree, whose Elements lxml refuses, so
every ref came back with an empty XML blob and getMetaData skipped
everything it reads from the XML. Posts published through
/update_publications in that window were left with:

  journal           ""
  keywords          "No keywords in Pubmed"   (and no tags)
  affiliations      ""
  funding_agencies  ""
  publication_date  ""   -> WP defaulted `date` to the creation time

An empty journal together with the keyword sentinel is the signature that
scan looks for. Title, authors, abstract and DOI come from pymed's own
parsing, so they were never affected.

What gets written
-----------------
Values come from getMetaData itself, so each post ends up with what
/update_publications would have written if the bug had never existed:

  journal, affiliations,     only if the post's field is still empty
  funding_agencies
  keywords + tags            only if keywords is still the sentinel and
                             PubMed has a KeywordList; tags are created or
                             resolved by name and added to any already on
                             the post
  content                    rebuilt to include the keywords line, only if
                             content.raw is still exactly what
                             _build_post_content produced (never hand-edited)
  publication_date + date    see below

Dates. An empty publication_date is filled, and `date` (the WP post date,
which the bug left at the creation time) is set to match, as the publish
path does. A publication_date that is set but disagrees with PubMed is
replaced only when it falls AFTER the post's `date`. Because the bug left
`date` at the creation time, a later publication_date means Pods stamped
the date field with "today" when someone saved the post in wp-admin; it is
not a real date. A publication_date on or before `date` was entered by hand
and is kept. scan lists those so you can check them.

Two passes
----------
  scan   - read the wp_cache publications snapshot, run getMetaData on the
           affected PMIDs, and write a manifest of per-post changes. No
           traffic to WordPress. Review (or hand-edit) the manifest before
           applying.

  apply  - for each manifest entry, GET the post (context=edit) and skip it
           if any field we would write has changed since the scan. Otherwise
           resolve its tags and POST the update. --dry-run does everything
           except the writes: no tags are created and no posts updated.

Afterwards, refill wp_cache (and with it Typesense) from WordPress:
  scripts/warm_wp_cache.sh https://www.sorghumbase.org

Usage
-----
  # Phase 1 (no WP traffic):
  python patch_missing_pubmed_metadata.py scan --out pubmed_meta_manifest.json

  # Phase 2 (needs auth):
  SB_WP_USERNAME=... SB_WP_PASSWORD=... \\
    python patch_missing_pubmed_metadata.py apply --manifest pubmed_meta_manifest.json --dry-run
  SB_WP_USERNAME=... SB_WP_PASSWORD=... \\
    python patch_missing_pubmed_metadata.py apply --manifest pubmed_meta_manifest.json
"""

import argparse
import contextlib
import importlib.util
import io
import json
import logging
import os
import sys
import time
from types import SimpleNamespace

import requests
from requests.auth import HTTPBasicAuth

DEFAULT_CACHE_URL = "https://www.sorghumbase.org/api/wp_cache/publications"
DEFAULT_WP_BASE = "https://content.sorghumbase.org/wordpress/index.php/wp-json/wp/v2"
NO_KEYWORDS = "No keywords in Pubmed"

logger = logging.getLogger("patch_pubmed_meta")


# ---------------------------------------------------------------------------
# PubMed metadata (via the webapp's own getMetaData)
# ---------------------------------------------------------------------------

def _load_pubmed_module():
    """Load utilities/pubmedIDpull.py by file path. Importing it as
    sorghum_webapp.utilities.pubmedIDpull would run the package __init__,
    which builds the whole Flask app from its config files."""
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        "..", "sorghum_webapp", "utilities", "pubmedIDpull.py")
    spec = importlib.util.spec_from_file_location("pubmedIDpull", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def fetch_metadata(pmids):
    """Run getMetaData on bare placeholders and return {pmid: fields} for
    every PMID PubMed returned. getMetaData leaves a placeholder untouched
    when PubMed has no record for it."""
    pubmed = _load_pubmed_module()
    papers = [SimpleNamespace(s=SimpleNamespace(pubmed_id=p)) for p in pmids]
    # getMetaData prints a "set date" line per paper; keep our stdout clean.
    with contextlib.redirect_stdout(io.StringIO()):
        pubmed.getMetaData(papers)
    out = {}
    for p in papers:
        s = p.s
        if not hasattr(s, "title"):
            continue
        out[s.pubmed_id] = {
            "journal": getattr(s, "journal", "") or "",
            "keywords": getattr(s, "keywords", "") or "",
            "affiliations": list(getattr(s, "affiliations", None) or []),
            "funding_agencies": list(getattr(s, "funding_agencies", None) or []),
            "publication_date": getattr(s, "publication_date", "") or "",
            "date": getattr(s, "date", "") or "",
        }
    return out


# ---------------------------------------------------------------------------
# Planning
# ---------------------------------------------------------------------------

def _norm(value):
    """Pods returns an empty list field as "" and a filled one as a
    string, so treat None / "" / [] alike when comparing."""
    if value in (None, "", [], {}):
        return ""
    if isinstance(value, str):
        return value.strip()
    return value


def _is_affected(post):
    return bool(
        (post.get("pubmed_id") or "").strip()
        and not (post.get("journal") or "").strip()
        and (post.get("keywords") or "").strip() == NO_KEYWORDS
    )


def _plan(post, meta):
    """Return (fields, current, notes): the values to write, the live
    values they replace (apply re-checks these before writing), and
    anything worth telling the operator."""
    fields, notes = {}, []
    if meta["journal"]:
        fields["journal"] = meta["journal"]
    if meta["keywords"] and meta["keywords"] != NO_KEYWORDS:
        fields["keywords"] = meta["keywords"]
    for k in ("affiliations", "funding_agencies"):
        if meta[k] and not _norm(post.get(k)):
            fields[k] = meta[k]

    cms_pub = (post.get("publication_date") or "").strip()
    post_day = (post.get("date") or "")[:10]
    pubmed_pub = meta["publication_date"]
    if pubmed_pub:
        if not cms_pub:
            fields["publication_date"] = pubmed_pub
        elif cms_pub != pubmed_pub:
            if cms_pub > post_day:
                fields["publication_date"] = pubmed_pub
                notes.append(f"replacing admin-save date {cms_pub} with {pubmed_pub}")
            else:
                notes.append(f"kept hand-entered publication_date {cms_pub} "
                             f"(PubMed: {pubmed_pub})")
        if "publication_date" in fields:
            fields["date"] = meta["date"]

    current = {k: _norm(post.get(k)) for k in fields}
    return fields, current, notes


# ---------------------------------------------------------------------------
# Post body
# ---------------------------------------------------------------------------

def _build_post_content(payload):
    """Copy of controllers/update_publications._build_post_content (the
    controller can't be imported without the Flask app). Works on a WP
    post dict too, since Pods returns its fields top-level."""
    parts = [payload.get("abstract") or "", payload.get("paper_authors") or ""]
    kw = payload.get("keywords") or ""
    if kw and kw != NO_KEYWORDS:
        parts.append(kw)
    if payload.get("pubmed_id"):
        parts.append(payload["pubmed_id"])
    if payload.get("doi"):
        parts.append(payload["doi"])
    return "\n".join(p for p in parts if p)


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


def wp_tag_id(wp_base, name, auth):
    """Create a tag, or return the id of the existing one. WP answers a
    duplicate name with 400 term_exists + data.term_id, which is the same
    handling as wordpress_orm's Tag.post."""
    url = f"{wp_base.rstrip('/')}/tags"
    resp = requests.post(url, json={"name": name}, auth=auth, timeout=60)
    if resp.ok:
        return int(resp.json()["id"])
    try:
        j = resp.json()
    except ValueError:
        j = {}
    if j.get("code") == "term_exists":
        return int(j["data"]["term_id"])
    raise RuntimeError(f"tag {name!r}: {resp.status_code} "
                       f"{j.get('code') or ''} {j.get('message') or (resp.text or '')[:200]}")


# ---------------------------------------------------------------------------
# scan
# ---------------------------------------------------------------------------

def cmd_scan(args):
    # No WP traffic at scan time -- we trust the wp_cache snapshot, and
    # apply re-checks every field against the live post before writing.
    logger.info("fetching publications snapshot from %s", args.cache_url)
    resp = requests.get(args.cache_url, timeout=180)
    resp.raise_for_status()
    pubs = resp.json()
    affected = [p for p in pubs if _is_affected(p) and p.get("id")]
    logger.info("%d of %d publications carry the bug signature", len(affected), len(pubs))

    pmids = sorted({p["pubmed_id"].strip() for p in affected})
    logger.info("running getMetaData for %d PMIDs", len(pmids))
    meta_by_pmid = fetch_metadata(pmids)
    logger.info("PubMed returned metadata for %d/%d PMIDs", len(meta_by_pmid), len(pmids))

    entries = []
    no_record = []
    nothing_to_add = []
    for post in sorted(affected, key=lambda p: p["id"]):
        pmid = post["pubmed_id"].strip()
        meta = meta_by_pmid.get(pmid)
        if meta is None:
            no_record.append(f"wp_id={post['id']} pmid={pmid}")
            continue
        fields, current, notes = _plan(post, meta)
        if not fields:
            nothing_to_add.append(f"wp_id={post['id']} pmid={pmid}")
            continue
        entries.append({
            "wp_id": post["id"],
            "pubmed_id": pmid,
            "slug": post.get("slug") or "",
            "fields": fields,
            "current": current,
            "notes": notes,
        })

    for e in entries:
        for note in e["notes"]:
            print(f"wp_id={e['wp_id']} pmid={e['pubmed_id']}: {note}")
    for line in no_record:
        print(f"{line}: PubMed returned no record; skipped")
    for line in nothing_to_add:
        print(f"{line}: PubMed has nothing to add; skipped")

    counts = {k: sum(1 for e in entries if k in e["fields"])
              for k in ("journal", "keywords", "affiliations", "funding_agencies", "publication_date")}
    logger.info(
        "scan summary: %d posts to patch (%s) | %d with no PubMed record | "
        "%d with nothing to add",
        len(entries), ", ".join(f"{k} {v}" for k, v in counts.items()),
        len(no_record), len(nothing_to_add),
    )

    with open(args.out, "w") as f:
        json.dump({
            "version": 1,
            "wp_base": args.wp_base,
            "entries": entries,
        }, f, indent=2)
    print(f"wrote {len(entries)} entries to {args.out}")


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

    tag_ids = {}  # lowercased keyword -> WP tag id, shared across the run
    succeeded = 0
    skipped_drift = 0
    failed = []
    for e in entries:
        wp_id = e["wp_id"]
        pmid = e["pubmed_id"]
        fields = dict(e["fields"])

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
        drifted = [k for k, v in e["current"].items() if _norm(post.get(k)) != v]
        if drifted:
            # Someone (an admin, or an earlier run of this script) changed
            # these fields since the scan. Don't clobber them.
            skipped_drift += 1
            logger.info("wp_id=%s pmid=%s changed since scan (%s); skipping",
                        wp_id, pmid, ", ".join(drifted))
            continue

        keywords = [w.strip() for w in fields.get("keywords", "").split(",") if w.strip()]
        content_raw = (post.get("content") or {}).get("raw") or ""
        if keywords and content_raw == _build_post_content(post):
            fields["content"] = _build_post_content({**post, **fields})
            content_note = "content rebuilt"
        elif keywords:
            content_note = "content unchanged (hand-edited)"
        else:
            content_note = "content unchanged"

        msg = (f"wp_id={wp_id} pmid={pmid} "
               f"set {', '.join(k for k in e['fields'])}; "
               f"{len(keywords)} tags; {content_note}")
        if args.dry_run:
            print(f"[dry-run] {msg}")
            continue
        try:
            merged_tags = list(post.get("tags") or [])
            for kw in keywords:
                key = kw.lower()
                if key not in tag_ids:
                    tag_ids[key] = wp_tag_id(wp_base, kw, auth)
                if tag_ids[key] not in merged_tags:
                    merged_tags.append(tag_ids[key])
            if keywords:
                fields["tags"] = merged_tags
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
    if succeeded:
        print("now refill wp_cache + Typesense: scripts/warm_wp_cache.sh https://www.sorghumbase.org")
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

    s = sub.add_parser("scan", help="find posts missing PubMed metadata, write manifest")
    s.add_argument("--cache-url", default=DEFAULT_CACHE_URL)
    s.add_argument("--wp-base", default=DEFAULT_WP_BASE,
                   help="recorded in the manifest for the apply phase")
    s.add_argument("--out", default="pubmed_meta_manifest.json")
    s.set_defaults(func=cmd_scan)

    a = sub.add_parser("apply", help="apply patches from manifest")
    a.add_argument("--manifest", default="pubmed_meta_manifest.json")
    a.add_argument("--wp-base", default="",
                   help="overrides wp_base recorded in the manifest")
    a.add_argument("--dry-run", action="store_true",
                   help="print what would change without creating tags or updating posts")
    a.add_argument("--sleep", type=float, default=0.5,
                   help="seconds between post updates (default 0.5)")
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
