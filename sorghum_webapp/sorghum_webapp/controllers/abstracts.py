#!/usr/bin/python

"""
/abstracts listing page.

Reads conference abstracts and SICNA tags from the server-side wp_cache so
each pageview is one Redis fetch instead of many WordPress REST calls. The
FathGrid table is built client-side from `templateDict['abstracts']`; see
templates/abstracts.html for the field shape the template expects.
"""

import re

import flask
from flask import render_template

from wordpress_orm import wp_session

from .. import app
from .. import wordpress_api as api
from .navbar import navbar_template
from .footer import populate_footer_template
from . import wp_cache as wp_cache_mod

abstracts_list = flask.Blueprint("abstracts_list", __name__)

# Tag names look like "SICNA 2024" -> ("SICNA", "2024").
_TAG_YEAR_RE = re.compile(r"^(.*?)\s+(\d{4})\s*$")


def _derive_conf_year(tag):
    if not tag:
        return "", ""
    name = (tag.get("name") or "").strip()
    m = _TAG_YEAR_RE.match(name)
    if m:
        return m.group(1).strip(), m.group(2)
    return name, ""


def _normalize_orgs(presenter):
    """Coerce a presenter's affiliations into a list of {"post_title": str}
    dicts. In the wild we see three shapes:
      - list of plain strings (the common case for older abstracts)
      - list of dicts already shaped with post_title (and sometimes plus_code)
      - list of integer post IDs under `organization` (uncommon, requires
        a join we don't do here; skipped)
    """
    raw = presenter.get("affiliation") or presenter.get("organization") or []
    if not isinstance(raw, list):
        return []
    out = []
    for item in raw:
        if isinstance(item, str):
            name = item.strip()
            if name:
                out.append({"post_title": name})
        elif isinstance(item, dict):
            name = (item.get("post_title") or "").strip()
            if name:
                out.append(item)
        # integers (raw org IDs) and other shapes are dropped silently.
    return out


def _render_abstract(raw, tag_by_id):
    presenter = (raw.get("presenting_author") or [{}])[0] or {}
    first = (presenter.get("first_name") or "").strip()
    last = (presenter.get("last_name") or "").strip()
    if last and first:
        author = f"{last}, {first}"
    else:
        author = last or first or ""

    orgs = _normalize_orgs(presenter)

    tag_ids = raw.get("tags") or []
    conf, year = _derive_conf_year(tag_by_id.get(tag_ids[0]) if tag_ids else None)

    return {
        "id": raw.get("id", 0),
        "slug": raw.get("slug", ""),
        "title": (raw.get("title") or {}).get("rendered", ""),
        "content": (raw.get("content") or {}).get("rendered", ""),
        "type": raw.get("presentation_type", ""),
        "session": raw.get("session", ""),
        "author": author,
        "organizations": orgs,
        "conference": conf,
        "year": year,
    }


@abstracts_list.route("/abstracts")
def abstracts():
    templateDict = navbar_template("Resources")

    raw_abstracts, _ = wp_cache_mod._get_or_refresh("conference_abstracts")
    tags_list, _ = wp_cache_mod._get_or_refresh("sicna_tags")
    tag_by_id = {t["id"]: t for t in (tags_list or [])}

    rows = [_render_abstract(a, tag_by_id) for a in (raw_abstracts or [])]

    with api.Session():
        banner_media = api.media(slug="k-state-sorghum-field-1920x1000")
        templateDict["banner_media"] = banner_media
        populate_footer_template(
            template_dictionary=templateDict,
            wp_api=api,
            photos_to_credit=[banner_media],
        )

    templateDict["abstracts"] = rows
    return render_template("abstracts.html", **templateDict)
