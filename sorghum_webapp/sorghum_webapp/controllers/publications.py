#!/usr/bin/python

# from flask import request #, make_response

import flask
import logging
import json
import math
from flask import request, render_template
from wordpress_orm import wp_session
from wordpress_orm.entities.tag import Tag, TagRequest
from ..wordpress_orm_extensions.scientific_paper import ScientificPaperRequest

from ..utilities.pubmedIDpull import getMetaData

from .. import app
from .. import wordpress_api as api
#from .. import wordpress_orm_logger as wp_logger
from . import valueFromRequest
from .navbar import navbar_template
from .footer import populate_footer_template

#logger = logging.getLogger("wordpress_orm")
wp_logger = logging.getLogger("wordpress_orm")
app_logger = logging.getLogger("sorghumbase")

publications_page = flask.Blueprint("publications_page", __name__)

def getPapers(current_page, per_page, paper_tally, tag_filter, before, after, show_all, force_update):
    updatedPapers = []
    while show_all and per_page * (current_page-1) < paper_tally :
        updatedPapers += getPapers(current_page, per_page, paper_tally, tag_filter, before, after, False, force_update)
        current_page = current_page + 1
    if not show_all:
        paper_request = ScientificPaperRequest(api=api)
        if tag_filter:
            paper_request.tags = tag_filter
        if before:
            paper_count.before= before
        if after:
            paper_count.after= after
        paper_request.per_page = per_page
        paper_request.page = current_page
        page_of_papers = paper_request.get()

        queryPubmed = []
        for p in page_of_papers :
            if len(p.s.pubmed_id) > 0 and (force_update or len(p.s.content) == 0) :
               queryPubmed.append(p)
            else :
               updatedPapers.append(p)

        if len(queryPubmed) > 0:
            info = getMetaData(queryPubmed)

            for paper in info:
                if not len(paper.s.paper_authors) == 0 :
                    paper.s.content = paper.s.abstract + "\n" + paper.s.paper_authors
                    if paper.s.keywords != "No keywords in Pubmed":
                        paper.s.content += "\n" + paper.s.keywords
                        paper_tags = []
                        kwl = paper.s.keywords.split(',')
                        kwd = [w.strip() for w in kwl]
                        for keyword in kwd:
                            new_tag = Tag(api=api)
                            new_tag.s.name = keyword
                            tag_id = str(new_tag.post)
                            paper_tags.append(tag_id)
                            paper.s.tags = ', '.join(paper_tags)
                    paper.s.content += "\n" + paper.s.pubmed_id
                    if paper.s.doi:
                        paper.s.content += "\n" + paper.s.doi
                    print("calling paper.update()", paper.s.date)
                    paper.update()
                    print("updated paper", paper.s.pubmed_id, paper.s.title)
                    updatedPapers.append(paper)
                else :
                    updatedPapers.append(paper)
                    print("pubmed found no authors for",paper.s.pubmed_id)
    return updatedPapers

WAY_MORE_THAN_WE_WILL_EVER_HAVE = 100
@publications_page.route('/publications')
def publications():
    ''' List of research papers '''
    templateDict = navbar_template('Research')
    show_all = valueFromRequest(key="show_all", request=request, boolean=True) or False
    force_update = valueFromRequest(key="force_update", request=request, boolean=True) or False
    tag_filter = valueFromRequest(key="tag", request=request, aslist=True)
    before = valueFromRequest(key="before", request=request)
    after = valueFromRequest(key="before", request=request)
    current_page = valueFromRequest(key="page", request=request, integer=True) or 1
    per_page = valueFromRequest(key="per_page", request=request, integer=True) or 100
    with api.Session():
        paper_count = ScientificPaperRequest(api=api)
        if tag_filter:
            paper_count.tags = tag_filter
        if before:
            paper_count.before = before
        if after:
            paper_count.after = after
        paper_count.per_page = 1
        paper_count.page = 1
        paper_tally = paper_count.get(count=True)

        updatedPapers = getPapers(1, 100, paper_tally, tag_filter, before, after, True, force_update)

        tag_freq = {}

        for paper in updatedPapers:
            for tag in paper.s.tags:
                if tag not in tag_freq:
                    tag_freq[tag] = 1
                else:
                    tag_freq[tag] += 1
        first=0
        last=paper_tally
        if not show_all:
            first = per_page* (current_page-1)
            last = per_page * current_page
            if last > paper_tally:
                last = paper_tally
        templateDict['papers'] = updatedPapers[first:last]
        templateDict['page'] = current_page
        templateDict['n_pages'] = math.ceil(paper_tally / per_page)
        templateDict['n_papers'] = paper_tally
        if math.ceil(paper_tally / per_page) > 1:
            templateDict['url'] = f"/publications?per_page={per_page}"
            if tag_filter:
                templateDict['url'] += f"&tag={tag_filter}"
            templateDict['url'] += "&page="
        tags_tally = 0
        min_2_tags = {key: value for (key, value) in sorted(tag_freq.items(), reverse=True, key=lambda t: t[1]) if value > 0 }
        tlist= list(min_2_tags.keys())
        tag_names = {}
        tags_per_page=100
        tag_page = 0
        for i in range(0,len(tlist), tags_per_page):
            tag_page += 1
            tag_getter = TagRequest(api=api)
            tag_getter.per_page = tags_per_page
            tag_getter.page = tag_page
            tag_getter.include = ','.join(map(str,tlist[i:i+tags_per_page]))
            tag_getter.populate_request_parameters()
            page_of_tags = tag_getter.get()
            for t in page_of_tags :
                tag_names[t.s.id] = t.s.name
        templateDict['tags'] = min_2_tags
        templateDict['tagname'] = tag_names
        templateDict['tagfreq'] = tag_freq

    news_banner_media = api.media(slug="sorghum_panicle")
    templateDict["banner_media"] = news_banner_media

    populate_footer_template(template_dictionary=templateDict, wp_api=api, photos_to_credit=[news_banner_media])
    app_logger.debug(" ============= controller finished ============= ")

    return render_template("research_filter.html", **templateDict)
