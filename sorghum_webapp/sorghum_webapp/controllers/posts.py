#!/usr/bin/python

# from flask import request #, make_response

import flask
import logging
from flask import request, render_template
from wordpress_orm import wp_session
from ..wordpress_orm_extensions.germplasm import GermplasmRequest
from ..wordpress_orm_extensions.population import PopulationRequest
from ..wordpress_orm_extensions.user import SBUser
from math import ceil

from .. import app
from .. import wordpress_api as api
from . import valueFromRequest
from .navbar import navbar_template
from .footer import populate_footer_template

logger = logging.getLogger("wordpress_orm")

post_grid = flask.Blueprint("post_grid", __name__)
germplasm_grid = flask.Blueprint("germplasm_grid", __name__)
population_grid = flask.Blueprint("population_grid", __name__)

WAY_MORE_THAN_WE_WILL_EVER_HAVE = 100
spacer = " & "


@post_grid.route('/posts')
def posts():
	''' List of posts.

	The grid, banner, and pagination are rendered client-side by the
	PostsList react component, which hits the WordPress REST API directly
	and caches per page in money-clip. The Flask route now only renders
	the navbar/footer shell so it returns in milliseconds.
	'''
	categories = valueFromRequest(key="categories", request=request, aslist=True) or []
	active_menu = 'Resources'
	if categories and categories[0] == 'news':
		active_menu = 'News'
	elif categories and categories[0] == 'researchnote':
		active_menu = 'Community'
	templateDict = navbar_template(active_menu)
	return render_template("posts.html", **templateDict)

@germplasm_grid.route('/germplasms')
def germplasms():
	''' List of germplasms '''

	# templateDict = navbar_template(active_menu)
	templateDict = navbar_template('Germplasms')

	with api.Session():

		germplasm_request = GermplasmRequest(api=api)
		germplasms = germplasm_request.get()

		posts_banner_media = api.media(slug="k-state-sorghum-field-1920x1000")
		templateDict["banner_media"] = posts_banner_media
		populate_footer_template(template_dictionary=templateDict, wp_api=api, photos_to_credit=[posts_banner_media])

	templateDict['posts'] = germplasms
	templateDict['post_type'] = "Germplasms"

	return render_template("post_list.html", **templateDict)

@population_grid.route('/populations')
def populations():
	''' List of populations '''

	# templateDict = navbar_template(active_menu)
	templateDict = navbar_template('Germplasms')

	with api.Session():

		population_request = PopulationRequest(api=api)
		populations = population_request.get()

		posts_banner_media = api.media(slug="k-state-sorghum-field-1920x1000")
		templateDict["banner_media"] = posts_banner_media
		populate_footer_template(template_dictionary=templateDict, wp_api=api, photos_to_credit=[posts_banner_media])

	templateDict['posts'] = populations
	templateDict['post_type'] = "Populations"

	return render_template("post_list.html", **templateDict)
