#!/usr/bin/python

# This is the home page of the site.

import logging
from types import SimpleNamespace

import flask
from flask import render_template

from .. import app
from .navbar import navbar_template
from .footer import populate_footer_template

app_logger = logging.getLogger("sorghumbase")

index_page = flask.Blueprint("index_page", __name__)


def _media(source_url):
	"""Mimic the shape the slider template expects: ``banner.media.s.source_url``.

	The home page used to hit the WordPress media REST API for each slider
	asset on every request. The URLs are stable so we hardcode them here as
	static content instead.
	"""
	return SimpleNamespace(s=SimpleNamespace(source_url=source_url))


# Cached media URLs (previously resolved via api.media(slug=...)).
_TA_BANNER_IMG = "https://content.sorghumbase.org/wordpress/wp-content/uploads/2018/06/sorghum_sky_darker.jpg"
_TA_BANNER_VIDEO = "https://content.sorghumbase.org/wordpress/wp-content/uploads/2021/05/type-ahead.mp4"
_PG_BANNER_BG = "https://content.sorghumbase.org/wordpress/wp-content/uploads/2018/06/aerial_combines.jpg"
_PG_BANNER_FG = "https://content.sorghumbase.org/wordpress/wp-content/uploads/2022/02/test_img5.png"
_GN_BANNER_FG = "https://content.sorghumbase.org/wordpress/wp-content/uploads/2022/02/yellowseed1_neighborhood_v3.png"
_GN_BANNER_BG = "https://content.sorghumbase.org/wordpress/wp-content/uploads/2018/06/sorghum_panicle-e1644529666393.jpg"

_PG_GENES_FILTER = (
	"/genes?filters={%22status%22:%22init%22,%22operation%22:%22AND%22,"
	"%22negate%22:false,%22marked%22:false,%22leftIdx%22:0,%22rightIdx%22:3,"
	"%22children%22:[{%22fq_field%22:%22domains__ancestors%22,"
	"%22fq_value%22:%222182%22,%22name%22:%22NB-ARC%22,"
	"%22category%22:%22InterPro%20Domain%22,%22leftIdx%22:1,%22rightIdx%22:2,"
	"%22negate%22:false,%22showMenu%22:false,%22marked%22:true}],"
	"%22showMarked%22:true,%22showMenu%22:false,%22moveCopyMode%22:%22%22,"
	"%22searchOffset%22:0,%22rows%22:20}&genomes="
)


def _build_banners():
	return [
		{
			"id": "type-ahead",
			"group": "Select filters to search or refine a search",
			"media": _media(_TA_BANNER_IMG),
			"video": _media(_TA_BANNER_VIDEO),
			"link_url": "/genes",
			"link_text": "Try it!",
			"title": "type-ahead search",
			"format": "video",
		},
		{
			"id": "pan-genome-dist",
			"group": "The NB-ARC InterPro domain is often found in disease resistance genes.",
			"bgmedia": _media(_PG_BANNER_BG),
			"media": _media(_PG_BANNER_FG),
			"link_url": _PG_GENES_FILTER,
			"link_text": "Explore",
			"title": "pan-genome distribution",
			"format": "left",
		},
		{
			"id": "neighbors",
			"group": "The Yellow seed1 gene has two to three local copies in sorghum.",
			"media": _media(_GN_BANNER_FG),
			"bgmedia": _media(_GN_BANNER_BG),
			"link_url": "/genes?idList=SORBI_3001G397900",
			"link_text": "Search for homologs",
			"title": "MYB transcription factor",
			"format": "left",
		},
	]


@index_page.route("/", methods=['GET'])
def index():
	'''
	Home page.

	The three "Latest News / Recent Research / Special Topics" sections
	are rendered client-side by the React HomeSection component, which
	hits the WordPress REST API directly and caches in money-clip.
	Slider media URLs are inlined as static content (see _build_banners).
	'''

	templateDict = navbar_template()
	templateDict["banners"] = _build_banners()
	templateDict["toolicons"] = ["icon-layers", "icon-telescope", "icon-globe"]

	populate_footer_template(template_dictionary=templateDict)

	app_logger.debug(" ============= controller finished ============= ")
	return render_template("index.html", **templateDict, zip=zip)
