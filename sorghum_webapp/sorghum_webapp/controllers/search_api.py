#!/usr/bin/python

# from flask import request #, make_response
import os
import requests
import json
import flask
import logging
import urllib.parse
from flask import request, jsonify

from .. import app
from . import valueFromRequest

WP_BASE_URL = app.config["WP_BASE_URL"]

WP_CATS = ['posts', 'pages', 'users', 'resource-link', 'job', 'event', 'scientific_paper', 'project', 'tags', 'conference_abstract']

search_api = flask.Blueprint("search_api", __name__)

logger = logging.getLogger("sorghumbase")

@search_api.route('/search_api/<cat>')
def searchapi(cat):
    q = valueFromRequest(key="q", request=request)
    rows = valueFromRequest(key="rows", request=request)
    if cat in WP_CATS:
        with requests.Session() as session:
            results_dict = {}
            if cat == 'tags':
                url = WP_BASE_URL + cat + '?per_page=100'
                page = 0
                done = 0
                while done == 0:
                    page = page+1
                    purl = url + '&page=' + str(page)
                    print(purl)
                    response = session.get(url=purl, verify=False)
                    tags = response.json()
                    for tag in tags:
                        results_dict[str(tag['id'])] = tag['name']
                    if len(tags) == 0:
                        done = 1
                results = jsonify(results_dict)
                results.headers.add('Access-Control-Allow-Origin','*')
                return results
            url = WP_BASE_URL + cat + '?_embed=true'
            if q:
                results_dict['q'] = q
                q = urllib.parse.quote(q)
                url = url + '&search=' + q
            if cat == 'posts':
                url = url + '&categories_exclude=8,17'
            if rows:
                url = url + '&per_page=' + rows
            if cat == 'users':
                session.auth = (os.environ['SB_WP_USERNAME'], os.environ['SB_WP_PASSWORD'])
                url = WP_BASE_URL + cat + '?context=edit&roles=team_member&per_page=50&search=' + q
            response = session.get(url=url, verify=False)
            if cat == 'resource-link':
                links = response.json()
                mediaIDs = []
                mediaIDToLink = {}
                for item in links:
                    if item['resource_image']:
                        id = str(item['resource_image'][0]['id'])
                        mediaIDs.append(id)
                        mediaIDToLink[id] = item
                if mediaIDs:
                    batchSize = 100
                    start = 0
                    while start < len(mediaIDs):
                        batch = mediaIDs[start:start+batchSize]
                        start += batchSize
                        url2 = WP_BASE_URL + 'media?per_page=100&include=' + ','.join(batch)
                        response2 = session.get(url=url2)
                        media = response2.json()
                        for mediaItem in media:
                            id = str(mediaItem['id'])
                            item = mediaIDToLink[id]
                            item['resource_image'][0]['source_url'] = mediaItem['source_url']
                results_dict['docs'] = links
            else :
                results_dict['docs'] = response.json()
            results_dict['numFound'] = int(response.headers['X-WP-TOTAL'])
            results = jsonify(results_dict)
    else:
        results = jsonify(WP_CATS)
    results.headers.add('Access-Control-Allow-Origin','*')
    return results
