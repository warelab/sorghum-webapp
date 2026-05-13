#!/usr/bin/python

import flask
import logging
from flask import render_template

from .. import app
from .navbar import navbar_template

logger = logging.getLogger("wordpress_orm")

events_page = flask.Blueprint("events_page", __name__)


@events_page.route('/events')
def events():
	''' Events page.

	The timeline, banner, and past/upcoming toggle are rendered client-side
	by the EventsList react component, which hits /api/wp_cache/events
	(server-side Redis cache) and stores results in money-clip with a
	24-hour TTL. The Flask route now only renders the navbar/footer shell
	so it returns in milliseconds.
	'''
	templateDict = navbar_template('News')
	return render_template("events.html", **templateDict)
