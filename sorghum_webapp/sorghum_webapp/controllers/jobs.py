#!/usr/bin/python

# from flask import request #, make_response

import flask
import logging
from flask import request, render_template
from ..wordpress_orm_extensions.job import JobRequest

from wordpress_orm import wp_session

from .. import app
from .. import wordpress_api as api
from . import valueFromRequest
from .navbar import navbar_template
from .footer import populate_footer_template

logger = logging.getLogger("wordpress_orm")

jobs_page = flask.Blueprint("jobs_page", __name__)

@jobs_page.route('/jobs')
def jobs():
	''' Jobs page. '''
	templateDict = navbar_template('News')

	with api.Session():
		job_request = JobRequest(api=api)

		jobs = job_request.get()

		news_banner_media = api.media(slug="sorghum_panicle")
		templateDict["banner_media"] = news_banner_media

		populate_footer_template(template_dictionary=templateDict, wp_api=api, photos_to_credit=[news_banner_media])

	templateDict['jobs'] = jobs


	return render_template("jobs.html", **templateDict, len=len)
