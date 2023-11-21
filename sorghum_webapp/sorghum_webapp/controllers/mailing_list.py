#!/usr/bin/python

# from flask import request #, make_response

import os
import re
import flask
import logging
import requests
from flask import request, render_template

from wordpress_orm import wp_session

from .. import app
from .. import wordpress_api as api
from . import valueFromRequest
from .navbar import navbar_template
from .footer import populate_footer_template

logger = logging.getLogger("wordpress_orm")


def is_valid_recaptcha(client_response):
    url = "https://www.google.com/recaptcha/api/siteverify"
    data = {"response": client_response, "secret": os.environ['SB_RECAPTCHA_SECRET']}
    response = requests.post(url, data=data)
    if response.status_code == 200:
        json_data = response.json()
        return json_data['success']
    else:
        print(f"POST request failed with status code {response.status_code}")
        return False

def is_valid_email(email):
    # Define the regular expression pattern for a valid email address
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'

    # Use re.match to check if the email matches the pattern
    match = re.match(pattern, email)

    # Return True if there is a match, indicating a valid email address; otherwise, return False
    return bool(match)

mailing_list_page = flask.Blueprint("mailing_list_page", __name__)

@mailing_list_page.route('/mailing_list', methods=['GET','POST'])
def mailing_list():
    ''' Mailing list page. '''
    templateDict = navbar_template('Engage')

    email = valueFromRequest(key="widget-subscribe-form-email", request=request)
    recaptcha = valueFromRequest(key="g-recaptcha-response", request=request)

    if email and recaptcha:
        if is_valid_email(email):
            if is_valid_recaptcha(recaptcha):
                # add this email address to the mailing list
                mailmanUrl = "http://brie4.cshl.edu/mailman/subscribe/sorghum-community"
                r = requests.post(mailmanUrl, data={'email': email})
                if r.status_code == 200:
                    templateDict["subscribed"] = True
                else:
                    templateDict["error"] = r.reason
            else:
                templateDict["error"] = "recaptcha validation failed"
        else:
            templateDict["error"] = f"'{email}' is not a valid email address."
    with api.Session():
        ms_banner_media = api.media(slug="sorghum_combine")
        templateDict["banner_media"] = ms_banner_media

        logger.debug(ms_banner_media.json)
        populate_footer_template(template_dictionary=templateDict, wp_api=api, photos_to_credit=[ms_banner_media])

    return render_template("mailing_list.html", **templateDict)
