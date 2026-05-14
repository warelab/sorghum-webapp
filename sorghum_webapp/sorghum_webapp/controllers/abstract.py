#!/usr/bin/python

"""
/abstract/<slug>

Thin server shell — the actual rendering is done by the AbstractDetail React
component (search_app/src/components/abstractDetail.js), which fetches the
abstract list from /api/wp_cache/conference_abstracts and renders the one
matching the slug. The Flask side just provides the banner URL and the slug
so the page doesn't depend on WordPress at request time.
"""

import flask
from flask import render_template

from .. import wordpress_api as api
from .navbar import navbar_template
from .footer import populate_footer_template

abstract_page = flask.Blueprint("abstract_page", __name__)


@abstract_page.route("/abstract/<slug>")
def abstract(slug):
    templateDict = navbar_template()

    with api.Session():
        banner_media = api.media(slug="sorghum-grains_1920x1000")
        populate_footer_template(
            wp_api=api,
            template_dictionary=templateDict,
            photos_to_credit=[],
        )

    templateDict["banner_url"] = banner_media.s.source_url
    templateDict["slug"] = slug
    return render_template("abstract.html", **templateDict)
