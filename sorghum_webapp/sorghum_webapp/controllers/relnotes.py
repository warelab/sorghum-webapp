#!/usr/bin/python

# from flask import request #, make_response

import flask
import logging
import os
from flask import request, render_template, jsonify

from .. import app
from .. import wordpress_api as api
from . import valueFromRequest
from .navbar import navbar_template
from .footer import populate_footer_template
from .local_media import local_banner
logger = logging.getLogger("wordpress_orm")

relnotes_page = flask.Blueprint("relnotes_page", __name__)
@relnotes_page.route('/relnotes', methods=['GET'])
def feedbackPage():
    templateDict = navbar_template('News')
    templateDict["banner_media"] = local_banner("aerial_combines")

    populate_footer_template(template_dictionary=templateDict, wp_api=api)
    return render_template("release_notes.html", **templateDict)