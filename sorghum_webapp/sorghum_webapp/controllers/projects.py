#!/usr/bin/python

# from flask import request #, make_response

import flask
import logging
import json
from flask import request, render_template
from ..wordpress_orm_extensions.project import ProjectRequest

from wordpress_orm import wp_session

from .. import app
from .. import wordpress_api as api
from . import valueFromRequest
from .navbar import navbar_template
from .footer import populate_footer_template

logger = logging.getLogger("wordpress_orm")

projects_list = flask.Blueprint("projects_list", __name__)

def getProjects(current_page, per_page, project_tally, tag_filter, force_update, show_all):
    updatedProjects = []
    while show_all and per_page * (current_page-1) < project_tally :
        updatedProjects += getProjects(current_page, per_page, project_tally, tag_filter, force_update, False)
        current_page = current_page + 1
    if not show_all:
        project_request = ProjectRequest(api=api)
        if tag_filter:
            project_request.tags = tag_filter
        project_request.per_page = per_page
        project_request.page = current_page
        page_of_projects = project_request.get()

        projectsToUpdate = []
        for p in page_of_projects :
            if len(p.s.project_title) > 0 and (force_update or len(p.s.content) == 0) :
               projectsToUpdate.append(p)
            else :
               updatedProjects.append(p)

        if len(projectsToUpdate) > 0:
            for project in projectsToUpdate:
                if not len(project.s.project_description) == 0 :
                    project.s.content = project.s.project_title
                    project.s.content += "\n" + project.s.project_description
                    project.s.content += "\n" + project.s.funding_agency
                    project.s.content += "\n" + project.s.award_id
                    project.s.content += "\n" + project.s.awardees
                    project.update()
                    updatedProjects.append(project)
                else :
                    updatedProjects.append(project)
    return updatedProjects

@projects_list.route('/projects')
def projects():
    ''' Projects page. '''
    templateDict = navbar_template('Resources')
    show_all = valueFromRequest(key="show_all", request=request, boolean=True) or True
    force_update = valueFromRequest(key="force_update", request=request, boolean=True) or False
    tag_filter = request.args.getlist("tag")
    current_page = valueFromRequest(key="page", request=request, integer=True) or 1
    per_page = valueFromRequest(key="per_page", request=request, integer=True) or 100

    with api.Session():
        project_count = ProjectRequest(api=api)
        project_count.per_page = 1
        project_count.page = 1
        project_tally = project_count.get(count=True)
        print(f"project_tally {project_tally}")
        if force_update:
            projects = getProjects(1, 100, project_tally, tag_filter, force_update, True)
        else:
            projects = getProjects(current_page, per_page, project_tally, tag_filter, force_update, show_all)

        news_banner_media = api.media(slug="k-state-sorghum-field-1920x1000")
        templateDict["banner_media"] = news_banner_media

        populate_footer_template(template_dictionary=templateDict, wp_api=api, photos_to_credit=[news_banner_media])

    templateDict['projects'] = projects

    return render_template("projects.html", **templateDict)
