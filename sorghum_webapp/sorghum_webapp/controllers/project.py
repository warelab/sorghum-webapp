#!/usr/bin/python

"""
/project/<slug>

Thin server shell — the actual rendering is done by the ProjectDetail React
component (search_app/src/components/projectDetail.js), which finds the
matching project in the wp_cache-backed list (cached locally in money-clip).
Flask just provides the banner image URL and the slug, so the request path
doesn't hit WordPress.
"""

import flask
from flask import render_template

from .. import wordpress_api as api
from .navbar import navbar_template
from .footer import populate_footer_template

project_page = flask.Blueprint("project_page", __name__)


@project_page.route("/project/<slug>")
def project(slug):
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
    return render_template("project.html", **templateDict)
