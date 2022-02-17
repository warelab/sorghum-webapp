#!/usr/bin/python

# from flask import request #, make_response

import flask
import logging
import json
from flask import request, render_template
from wordpress_orm import wp_session
from wordpress_orm.entities import Tag
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

WAY_MORE_THAN_WE_WILL_EVER_HAVE = 100
@publications_page.route('/publications')
def publications():
    ''' List of research papers '''
    templateDict = navbar_template('Research')
    update_all = valueFromRequest(key="update_by_pubmed", request=request) or 0
    print("update_all?",update_all)
    with api.Session():
        paper_count = ScientificPaperRequest(api=api)
        paper_tally = paper_count.get(count=True)
        current_page=0
        per_page = 100

        updatedPapers = []
        all_keywords = set()
        all_years = []

        while per_page * current_page < paper_tally :
            current_page = current_page + 1
            paper_request = ScientificPaperRequest(api=api)
            paper_request.per_page = per_page
            paper_request.page = current_page
            page_of_papers = paper_request.get()

            queryPubmed = []
            for p in page_of_papers :
                if len(p.s.pubmed_id) > 0 and (update_all == '1' or len(p.s.abstract) == 0) :
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
                        paper.s.content += "\n" + paper.s.doi
                        paper.update()
                        print("updated paper", paper.s.pubmed_id, paper.s.title)
                        updatedPapers.append(paper)
                    else :
                        updatedPapers.append(paper)
                        print("pubmed found no authors for",paper.s.pubmed_id)

        papersByDate = sorted(updatedPapers, reverse=True, key=lambda k: k.s.publication_date)
        for paper in papersByDate:
            if len(paper.s.keywords) > 0 and paper.s.keywords != "No keywords in Pubmed":
                kwl = paper.s.keywords.split(',')
                kwd = [w.strip() for w in kwl]
                [all_keywords.add(x) for x in kwd]
            if paper.s.publication_date[:4] not in all_years:
                all_years.append(paper.s.publication_date[:4])


        templateDict['papers'] = papersByDate
        templateDict['keywords'] = all_keywords
        templateDict['years'] = all_years

    news_banner_media = api.media(slug="sorghum_panicle")
    templateDict["banner_media"] = news_banner_media

    populate_footer_template(template_dictionary=templateDict, wp_api=api, photos_to_credit=[news_banner_media])
    app_logger.debug(" ============= controller finished ============= ")

    return render_template("research_filter.html", **templateDict)
