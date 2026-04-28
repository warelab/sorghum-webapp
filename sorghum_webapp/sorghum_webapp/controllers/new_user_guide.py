#!/usr/bin/python

import flask
import logging
from flask import render_template

from .. import wordpress_api as api
from .navbar import navbar_template
from .footer import populate_footer_template

logger = logging.getLogger("sorghumbase")

new_user_guide_page = flask.Blueprint("new_user_guide_page", __name__)


@new_user_guide_page.route('/new-user-guide')
def new_user_guide():
	'''Interactive decision tree to help new users navigate SorghumBase.'''
	templateDict = navbar_template('Engage')

	with api.Session():
		# Reuse the FAQ banner ("aerial_combines") for visual consistency.
		banner_media = api.media(slug="aerial_combines")
		templateDict["banner_media"] = banner_media

		populate_footer_template(template_dictionary=templateDict,
								 wp_api=api,
								 photos_to_credit=[banner_media])

	return render_template("new_user_guide.html", **templateDict)
