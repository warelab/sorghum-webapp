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

logger = logging.getLogger("wordpress_orm")

conference_page = flask.Blueprint("conference_page", __name__)

@conference_page.route('/conferences')
def conference():
	''' Conference page. '''
	templateDict = navbar_template('News')

	with api.Session():

		ms_banner_media = api.media(slug="aerial_combines")
		templateDict["banner_media"] = ms_banner_media
		templateDict["conference_slug"] = "sicna-2024"
		templateDict["conference_name"] = "SICNA 2024"

		logger.debug(ms_banner_media.json)
		populate_footer_template(template_dictionary=templateDict, wp_api=api, photos_to_credit=[ms_banner_media])

	return render_template("conference.html", **templateDict)
