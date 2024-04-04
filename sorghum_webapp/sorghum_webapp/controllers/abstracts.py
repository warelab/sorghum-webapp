#!/usr/bin/python

# from flask import request #, make_response

import flask
import logging
import json
from flask import request, render_template
from ..wordpress_orm_extensions.abstract import AbstractRequest

from wordpress_orm import wp_session

from .. import app
from .. import wordpress_api as api
from . import valueFromRequest
from .navbar import navbar_template
from .footer import populate_footer_template

logger = logging.getLogger("wordpress_orm")

abstracts_list = flask.Blueprint("abstracts_list", __name__)

def getAbstracts(current_page, per_page, abstract_tally, tag_filter, show_all):
    updatedAbstracts = []
    while show_all and per_page * (current_page-1) < abstract_tally :
        updatedAbstracts += getAbstracts(current_page, per_page, abstract_tally, tag_filter, False)
        current_page = current_page + 1
    if not show_all:
        abstract_request = AbstractRequest(api=api)
        if tag_filter:
            abstract_request.tags = tag_filter
        abstract_request.per_page = per_page
        abstract_request.page = current_page
        page_of_abstracts = abstract_request.get()

        for p in page_of_abstracts :
           updatedAbstracts.append(p)

    return updatedAbstracts

@abstracts_list.route('/abstracts')
def abstracts():
    ''' Abstracts page. '''
    templateDict = navbar_template('Resources')
    show_all = valueFromRequest(key="show_all", request=request, boolean=True) or True
    tag_filter = request.args.getlist("tag")
    current_page = valueFromRequest(key="page", request=request, integer=True) or 1
    per_page = valueFromRequest(key="per_page", request=request, integer=True) or 100

    with api.Session():
        abstract_count = AbstractRequest(api=api)
        abstract_count.per_page = 1
        abstract_count.page = 1
        abstract_tally = abstract_count.get(count=True)
        abstracts = getAbstracts(current_page, per_page, abstract_tally, tag_filter, show_all)

        news_banner_media = api.media(slug="k-state-sorghum-field-1920x1000")
        templateDict["banner_media"] = news_banner_media

        populate_footer_template(template_dictionary=templateDict, wp_api=api, photos_to_credit=[news_banner_media])

        def getInfo(ab):
            orgs = []
            if ab.s.presenting_author_institutions:
                orgs = ab.s.presenting_author_institutions
            return {
            'author':ab.s.presenting_author,
            'title':ab.s.title,
            'content':ab.s.content,
            'conference':ab.s.conference_name,
            'year':ab.s.conference_date,
            'slug': ab.s.slug,
            'id': ab.s.id,
            'organizations': json.dumps(orgs)
            }
        iterator = map(getInfo,abstracts)
    templateDict['abstracts'] = list(iterator)
    return render_template("abstracts.html", **templateDict)

