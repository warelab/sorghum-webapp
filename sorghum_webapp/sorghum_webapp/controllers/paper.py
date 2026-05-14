#!/usr/bin/python

"""
/paper/<slug>

Thin server shell — the actual rendering is done by the PaperDetail React
component (search_app/src/components/paperDetail.js), which finds the paper
in the wp_cache-backed publications list. The slug param accepts either the
WP slug or the numeric post ID, since project-detail links use the latter.
"""

import flask
from flask import render_template

from .. import wordpress_api as api
from .navbar import navbar_template
from .footer import populate_footer_template

paper_page = flask.Blueprint("paper_page", __name__)


@paper_page.route("/paper/<slug>")
def paper(slug):
    templateDict = navbar_template("Research")

    with api.Session():
        banner_media = api.media(slug="sorghum-grains_1920x1000")
        populate_footer_template(
            wp_api=api,
            template_dictionary=templateDict,
            photos_to_credit=[],
        )

    templateDict["banner_url"] = banner_media.s.source_url
    templateDict["slug"] = slug
    return render_template("paper.html", **templateDict)
