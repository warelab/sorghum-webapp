#!/usr/bin/python

import flask
import logging
import requests
from flask import request, render_template

from . import valueFromRequest

logger = logging.getLogger("wordpress_orm")

index_page = flask.Blueprint("index_page", __name__)


@index_page.route('/', methods=['GET', 'POST'])
def index():
    ''' Mailing list page. '''
    templateDict = {}

    email = valueFromRequest(key="widget-subscribe-form-email", request=request)
    if email:
        # add this email address to the mailing list
        mailmanUrl = "http://brie4.cshl.edu/mailman/subscribe/sorghum-community"
        r = requests.post(mailmanUrl, data={'email': email})
        if r.status_code == 200:
            templateDict["subscribed"] = True
        else:
            templateDict["error"] = r.reason
    return render_template("index.html", **templateDict)
