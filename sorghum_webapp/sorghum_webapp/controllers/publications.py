#!/usr/bin/python

# from flask import request #, make_response

import flask
from flask import request, render_template
from .. import app
from .. import wordpress_api as api
from .navbar import navbar_template
from .footer import populate_footer_template
from .local_media import local_banner

publications_page = flask.Blueprint("publications_page", __name__)
@publications_page.route('/publications')
def publications():
    ''' List of research papers '''
    templateDict = navbar_template('Research')
    templateDict["banner_media"] = local_banner("k-state-sorghum-field-1920x1000")
    populate_footer_template(template_dictionary=templateDict, wp_api=api)

    return render_template("publications.html", **templateDict)
