#!/usr/bin/python

# from flask import request #, make_response

import flask
import logging
import json
from flask import request, render_template
from ..wordpress_orm_extensions.project import ProjectRequest
from datetime import datetime

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
        print("before project_request.get()")
        page_of_projects = project_request.get()
        print("after project_request.get()")

        projectsToUpdate = []
        for p in page_of_projects :
            if len(p.s.project_title) > 0 and (force_update or len(p.s.content) == 0) :
               projectsToUpdate.append(p)
            else :
               updatedProjects.append(p)
        print(f"projects to update {len(projectsToUpdate)}")

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

        def getInfo(p):
            orgs = []
            if p.s.organizations:
                orgs = p.s.organizations
            return {
            'funding_agency':p.s.funding_agency,
            'funding_program':p.s.funding_program,
            'funding_subcategory':p.s.funding_subcategory,
            'funding_link':p.s.funding_link,
            'award_id':p.s.award_id,
            'award_amount':p.s.award_amount,
            'project_title':p.s.project_title,
            'start_date': p.s.start_date,
            'end_date': p.s.end_date,
            'slug': p.s.slug,
            'id': p.s.id,
            'pi': json.dumps(p.s.pi),
            'organizations': json.dumps(orgs)
            }

        # Convert the projects into a list of dictionaries
        iterator = map(getInfo, projects)
        project_list = list(iterator)

        # Sort the projects by 'start_date' (most recent to oldest)
        sorted_projects = sorted(
            project_list,
            key=lambda x: datetime.strptime(x['start_date'], '%Y-%m-%d'),
            reverse=True  # Sort in descending order (most recent first)
        )

        # Assign the sorted list to the templateDict
        templateDict['projects'] = sorted_projects

    return render_template("projects.html", **templateDict)

