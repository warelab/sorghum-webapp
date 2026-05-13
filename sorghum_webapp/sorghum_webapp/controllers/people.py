#!/usr/bin/python

''' People page.

The team / SUWG / former-team listings are rendered client-side by the
PeopleList react component, which fetches /api/people and caches the
payload in money-clip for 24 hours. The Flask route now only renders the
navbar/banner shell so it returns in milliseconds.
'''

import json
import logging
import os
import threading
import time

import flask
from flask import render_template
from requests.auth import HTTPBasicAuth

from .. import app
from .. import wordpress_api as wpapi
from .navbar import navbar_template
from .footer import populate_footer_template
from .local_media import local_banner
from ..wordpress_orm_extensions.user import SBUser

logger = logging.getLogger("sorghumbase")

people_page = flask.Blueprint("people_page", __name__)
people_api_page = flask.Blueprint("people_api_page", __name__)

# Roles we surface, in the order the page presents them.
_PEOPLE_GROUPS = (
    ("team",     ["team_member"]),
    ("sac",      ["sac"]),
    ("escapees", ["former_team_member"]),
)

_PEOPLE_TTL_SECONDS = 3600  # server-side memoization; client caches 24h
_people_cache = {"value": None, "fetched_at": 0.0}
_people_lock = threading.Lock()


def _resolve_image(user):
    ''' Per-user image: custom WP media keyed by username, falling back to
    the user's gravatar. Mirrors the pre-existing chooseFace() logic.
    '''
    try:
        media = wpapi.media(slug=user.s.username)
        if media is not None:
            return media.s.source_url
    except Exception:
        # Treat any lookup failure as "no custom photo" and fall through.
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


def _ensure_wp_auth():
    ''' UserRequest(context="edit") needs an authenticated session to return
    role-filtered results. The global auth block in __init__.py only fires
    when SB_WP_* *and* MANTIS_* are all configured; if MANTIS_* is missing
    in this environment, wordpress_api.authenticator stays None and the
    user list comes back empty. Fill it in from SB_WP_* on demand. '''
    if getattr(wpapi, "authenticator", None) is not None:
        return
    username = os.environ.get("SB_WP_USERNAME")
    password = os.environ.get("SB_WP_PASSWORD")
    if username and password:
        wpapi.authenticator = HTTPBasicAuth(username, password)
    else:
        logger.warning(
            "people: SB_WP_USERNAME / SB_WP_PASSWORD not set; /api/people will "
            "return empty role-filtered results"
        )


def _fetch_people_payload():
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


def _get_people_payload():
    now = time.time()
    cached = _people_cache["value"]
    if cached is not None and now - _people_cache["fetched_at"] < _PEOPLE_TTL_SECONDS:
        return cached

    with _people_lock:
        cached = _people_cache["value"]
        if cached is not None and now - _people_cache["fetched_at"] < _PEOPLE_TTL_SECONDS:
            return cached
        logger.info("people: refreshing payload from WordPress")
        payload = _fetch_people_payload()
        _people_cache["value"] = payload
        _people_cache["fetched_at"] = time.time()
        return payload


@people_page.route('/people')
def people():
    templateDict = navbar_template('About')
    templateDict["banner_media"] = local_banner("sorghum_combine")
    populate_footer_template(template_dictionary=templateDict, wp_api=wpapi)
    return render_template("people.html", **templateDict)


@people_api_page.route('/api/people')
def people_api():
    if flask.request.args.get("force") == "1":
        with _people_lock:
            _people_cache["value"] = None
            _people_cache["fetched_at"] = 0.0
    payload = _get_people_payload()
    return flask.jsonify(payload)
