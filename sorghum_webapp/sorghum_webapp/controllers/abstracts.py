#!/usr/bin/python

"""
/abstracts listing page.

Thin Flask shell — rendering is done by the AbstractsList React component
(search_app/src/components/abstractsList.js), which loads
conference_abstracts and sicna_tags from the client-side money-clip cache
(falling back to /api/wp_cache/...), validates them against the Typesense
abstracts collection count, and builds the FathGrid table in the browser.
"""

import flask
from flask import render_template

from .. import wordpress_api as api
from .navbar import navbar_template
from .footer import populate_footer_template

abstracts_list = flask.Blueprint("abstracts_list", __name__)


@abstracts_list.route("/abstracts")
def abstracts():
    templateDict = navbar_template("Resources")
    with api.Session():
        banner_media = api.media(slug="k-state-sorghum-field-1920x1000")
        templateDict["banner_media"] = banner_media
        populate_footer_template(
            template_dictionary=templateDict,
            wp_api=api,
            photos_to_credit=[banner_media],
        )
    return render_template("abstracts.html", **templateDict)
