#!/usr/bin/python

''' People page.

The team / SUWG / former-team listings are rendered client-side by the
PeopleList react component, which fetches /api/wp_cache/people and caches
the payload in money-clip for 24 hours. The server-side cache is the
Redis-backed wp_cache (cross-worker, SET-NX-coordinated, ~1h TTL); see
build_people_payload() below for the builder this module registers.
'''

import logging
import os

import flask
from flask import render_template
from requests.auth import HTTPBasicAuth

from .. import app
from .. import wordpress_api as wpapi
from .navbar import navbar_template
from .footer import populate_footer_template
from .local_media import local_banner
from .wp_cache import RESOURCES
from ..wordpress_orm_extensions.user import SBUser

logger = logging.getLogger("sorghumbase")

people_page = flask.Blueprint("people_page", __name__)

# Roles we surface, in the order the page presents them.
_PEOPLE_GROUPS = (
    ("team",     ["team_member"]),
    ("sac",      ["sac"]),
    ("escapees", ["former_team_member"]),
)


def _ensure_wp_auth():
    ''' UserRequest(context="edit") needs an authenticated session to return
    role-filtered results. The global auth block in __init__.py sets it
    up when SB_WP_USERNAME / SB_WP_PASSWORD are present in the
    environment; fill it in from the same env vars on demand here as a
    safety net (and to make dev runs that bypassed the global setup
    work). '''
    if getattr(wpapi, "authenticator", None) is not None:
        return
    username = os.environ.get("SB_WP_USERNAME")
    password = os.environ.get("SB_WP_PASSWORD")
    if username and password:
        wpapi.authenticator = HTTPBasicAuth(username, password)
    else:
        logger.warning(
            "people: SB_WP_USERNAME / SB_WP_PASSWORD not set; the people "
            "payload will be empty"
        )


def _resolve_image(user):
    ''' Per-user image: custom WP media keyed by username, falling back to
    the user's gravatar. Mirrors the original chooseFace() logic. '''
    try:
        media = wpapi.media(slug=user.s.username)
        if media is not None:
            return media.s.source_url
    except Exception:
        pass
    avatars = user.s.avatar_urls or {}
    return avatars.get("96") or avatars.get("48") or ""


def _serialize_user(user):
    return {
        "name":         user.s.name or "",
        "jobTitle":     user.job_title or "",
        "organization": user.organization or "",
        "imgURL":       _resolve_image(user),
    }


def build_people_payload():
    ''' wp_cache builder. Fetches team / sac / former-team users from
    WordPress and serializes them. Called at most once per TTL across all
    workers thanks to the wp_cache SET-NX lock. '''
    _ensure_wp_auth()
    payload = {}
    with wpapi.Session():
        for key, roles in _PEOPLE_GROUPS:
            req = wpapi.UserRequest()
            req.context = "edit"
            req.per_page = 50
            req.roles = roles
            users = req.get(class_object=SBUser)
            payload[key] = [_serialize_user(u) for u in users]
    return payload


# Register the builder with the generic wp_cache machinery so the payload
# is served from /api/wp_cache/people with the same Redis cache, refill
# locking, and ?force=1 invalidation as path-based resources.
RESOURCES["people"] = {"builder": build_people_payload}


@people_page.route('/people')
def people():
    templateDict = navbar_template('About')
    templateDict["banner_media"] = local_banner("sorghum_combine")
    populate_footer_template(template_dictionary=templateDict, wp_api=wpapi)
    return render_template("people.html", **templateDict)
