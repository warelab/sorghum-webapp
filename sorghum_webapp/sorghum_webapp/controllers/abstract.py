#!/usr/bin/python

# from flask import request #, make_response

import flask
from flask import request, render_template
from ..wordpress_orm_extensions.abstract import AbstractRequest

import wordpress_orm as wp
from wordpress_orm import wp_session, exc

from .. import app
from .. import wordpress_api as api
from . import valueFromRequest
from .navbar import navbar_template
from .footer import populate_footer_template

WP_BASE_URL = app.config["WP_BASE_URL"]

abstract_page = flask.Blueprint("abstract_page", __name__)

@abstract_page.route('/abstract/<slug>')
def abstract(slug):
	'''
	This page displays a single abstract retrieved from WordPress.
	'''
	templateDict = navbar_template()

	#api = wp.API(url="http://content.sorghumbase.org/wordpress/index.php/wp-json/wp/v2/")

	with api.Session():
		abstract_request = AbstractRequest(api=api)
		abstract_request.slug = slug
		# get the post based on the slug
		try:
			result = abstract_request.get()
			abstract = result[0]
		except exc.NoEntityFound:
			# TODO return top level posts page
			raise Exception("Return top level posts page, maybe with an alert of 'post not found'.")

		sorghum_grains_image = api.media(slug="sorghum-grains_1920x1000")

		populate_footer_template(wp_api=api, template_dictionary=templateDict, photos_to_credit=[])

	templateDict["abstract"] = abstract
	templateDict["sorghum_grains_image"] = sorghum_grains_image

	#logger.debug(" ============= controller finished ============= ")
	return render_template("abstract.html", **templateDict)
