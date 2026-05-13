#!/usr/bin/python

# from flask import request #, make_response

import flask
import logging
from flask import request, render_template

from wordpress_orm import wp_session

from .. import app
from .. import wordpress_api as api
from . import valueFromRequest
from .navbar import navbar_template
from .footer import populate_footer_template
from .local_media import local_banner

logger = logging.getLogger("wordpress_orm")

conference_page = flask.Blueprint("conference_page", __name__)

@conference_page.route('/conferences')
def conference():
	''' Conference page. '''
	templateDict = navbar_template('News')
	templateDict["banner_media"] = local_banner("aerial_combines")
	templateDict["conference_slug"] = valueFromRequest(key="conference", request=request, default="sicna-2024")

	populate_footer_template(template_dictionary=templateDict, wp_api=api)

	return render_template("conference.html", **templateDict)
