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

contact_page = flask.Blueprint("contact_page", __name__)

@contact_page.route('/contact')
def contact():
	''' Contact page. '''
	templateDict = navbar_template('About')

	with api.Session():

		ms_banner_media = api.media(slug="aerial_combines")
		templateDict["banner_media"] = ms_banner_media

		logger.debug(ms_banner_media.json)
		populate_footer_template(template_dictionary=templateDict, wp_api=api, photos_to_credit=[ms_banner_media])

	return render_template("contact.html", **templateDict)
