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

guides_page = flask.Blueprint("guides_page", __name__)
@guides_page.route('/guides', methods=['GET'])
def guidesPage():
    templateDict = navbar_template('Engage')
    templateDict["banner_media"] = local_banner("aerial_combines")

    populate_footer_template(template_dictionary=templateDict, wp_api=api)
    return render_template("quick_guides.html", **templateDict)

videos_page = flask.Blueprint("videos_page", __name__)
@videos_page.route('/videos', methods=['GET'])
def videosPage():
    templateDict = navbar_template('Engage')
    templateDict["banner_media"] = local_banner("aerial_combines")

    populate_footer_template(template_dictionary=templateDict, wp_api=api)
    return render_template("videos.html", **templateDict)
