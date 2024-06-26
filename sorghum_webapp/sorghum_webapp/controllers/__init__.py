#!/usr/bin/python

from flask import request #, make_response

# List all of the views to be automatically imported here.
__all__ = ["index", "controller1", "controller2"]

def valueFromRequest(key=None, request=None, default=None, lower=False, aslist=False, boolean=False, integer=False):
	''' Convenience function to retrieve values from HTTP requests (GET or POST).
		
		@param key Key to extract from HTTP request.
		@param request The HTTP request from Flask.
		@param default The default value if key is not found.
		@param lower Make the string lower case.
		@param list Check for a comma-separated list, returns a list of values.
	'''
	if request.method == 'POST':
		try:
			value = request.form[key]
		except KeyError:
			return default
	else: # GET
		if integer:
			value = request.args.get(key, default, type=int)
		else:
			value = request.args.get(key, default)
		if value == None:
			return default
			
	if boolean:
		value = True
	if lower:
		value = value.lower()
	if aslist:
		value = value.split(",")
	return value

def make_json_response(object):
	''' Takes an object to return as JSON and returns a Flask response, properly handling the headers. '''
	response = make_response(json.dumps(object))
	response.headers['Access-Control-Allow-Origin'] = "*" # needed for JSON
	response.mimetype = "application/json"
	return response
