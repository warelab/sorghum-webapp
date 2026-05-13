#!/usr/bin/python

''' Funded projects page.

The funding map, search box, and FathGrid table are rendered client-side
by the FundedProjects react component, which fetches /api/wp_cache/projects
(Redis-backed server cache) and stores the result in money-clip for 24
hours. The Flask route now only renders the navbar/banner shell so it
returns in milliseconds.
'''

import flask
import logging
from flask import render_template

from .. import app
from .. import wordpress_api as api
from .navbar import navbar_template
from .footer import populate_footer_template
from .local_media import local_banner

logger = logging.getLogger("wordpress_orm")

projects_list = flask.Blueprint("projects_list", __name__)


@projects_list.route('/projects')
def projects():
    templateDict = navbar_template('Resources')
    templateDict["banner_media"] = local_banner("k-state-sorghum-field-1920x1000")
    populate_footer_template(template_dictionary=templateDict, wp_api=api)
    return render_template("projects.html", **templateDict)
