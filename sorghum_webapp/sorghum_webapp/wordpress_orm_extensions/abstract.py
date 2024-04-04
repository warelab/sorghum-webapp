
'''

Custom WordPress object defined using the plugin WordPress Pods.

Ref: https://wordpress.org/plugins/pods/
'''
import json
import logging
import requests

from wordpress_orm import WPEntity, WPRequest, WPORMCacheObjectNotFoundError
from wordpress_orm.entities import Media

logger = logging.getLogger("wordpress_orm")

class Abstract(WPEntity):

	def __init__(self, id=None, api=None):
		super().__init__(api=api)

		# related objects that need to be cached
		self._author = None
		self._category = None
		self._featured_media = None

	def __repr__(self):
		if len(self.s.title) < 11:
			truncated_title = self.s.title
		else:
			truncated_title = self.s.title[0:10] + "..."
		return "<WP {0} object at {1}, url='{2}'>".format(self.__class__.__name__, hex(id(self)),
																			self.s.id,
																			truncated_title)

	@property
	def schema_fields(self):
		return ["id", "slug", "title", "content",
				"featured_media", "template",
				"presenting_author", "presenting_author_institutions", "conference_name","conference_date",
				"presentation_type"]

	@property
	def post_fields(self):
		'''
		Arguments for ABSTRACT requests.
		'''
		if self._post_fields is None:
			# Note that 'date' is excluded in favor of exclusive use of 'date_gmt'.
			self._post_fields = ["title", "content", "featured_media",
				"presenting_author", "presenting_author_institutions", "conference_name","conference_date",
				"presentation_type"]
		return self._post_fields

	def update(self):
		'''
		Updates a 'Abstract' object.
		'''

		self._data = self.s.__dict__

		url = self.api.base_url + "abstract" + "/{}".format(self.s.id) + "?context=edit"
		logger.debug("post data='{}'".format(self._data))
		try:
			super().post(url=url, data=self._data)
			logger.debug("URL='{}'".format(url))
			logger.debug("post data='{}'".format(self._data))
		except requests.exceptions.HTTPError:
			logger.debug("Post response code: {}".format(self.post_response.status_code))
			if self.post_response.status_code == 400: # bad request
				logger.debug("URL={}".format(self.post_response.url))
				raise Exception("400: Bad request. Error: \n{0}".format(json.dumps(self.post_response.json(), indent=4)))
			elif self.post_response.status_code == 404: # not found
				return None

	@property
	def categories(self):
		'''
		Returns a list of categories (as Category objects) associated with this post.
		'''
		if self._categories is None:
			self._categories = list()
			for category_id in self.s.categories:
				try:
					self._categories.append(self.api.category(id=category_id))
				except exc.NoEntityFound:
					logger.debug("Expected to find category ID={0} from post (ID={1}), but no category found.".format(category_id, self.s.id))
		return self._categories

	@property
	def featured_media(self):
		'''
		Returns the 'Media' object that is the "featured media" for this abstract.
		'''
		if self._featured_media is None and self.s.featured_media is not None:

			media_id = self.s.featured_media
			if media_id == 0:
				# no featured media for this post entry (this is what WordPress returns)
				self._featured_media = None
			else:
				self._featured_media = self.api.media(id=media_id)
		return self._featured_media

class AbstractRequest(WPRequest):
	'''
	A class that encapsulates requests for WordPress Abstracts.
	'''
	def __init__(self, api=None):
		super().__init__(api=api)
		self.id = None # WordPress ID
		self._before = None
		self._after = None
		self._page = None
		self._per_page= None

		self._status = list()
		self._category_ids = list()
		self._slugs = list()

	@property
	def parameter_names(self):
		return ["slug", "before", "after", "status", "categories", "featured_media"]

	def get(self, count=False):
		'''
		Returns a list of 'Abstract' objects that match the parameters set in this object.
		'''
		self.url = self.api.base_url + "abstract"

		if self.id:
			self.url += "/{}".format(self.id)

		# -------------------
		# populate parameters
		# -------------------
		if self.slug:
			self.parameters["slug"] = self.slug

		if self.before:
			self.parameters["before"] = self._before.isoformat()

		if self.after:
			self.parameters["after"] = self._after.isoformat()

		if self.page:
			self.parameters["page"] = self.page

		if self.per_page:
			self.parameters["per_page"] = self.per_page

		# -------------------

		try:
			self.get_response()
			logger.debug("URL='{}'".format(self.request.url))
		except requests.exceptions.HTTPError:
			logger.debug("Post response code: {}".format(self.response.status_code))
			if self.response.status_code == 400: # bad request
				logger.debug("URL={}".format(self.response.url))
				raise exc.BadRequest("400: Bad request. Error: \n{0}".format(json.dumps(self.response.json(), indent=4)))
			elif self.response.status_code == 404: # not found
				return None

		self.process_response_headers()

		if count:
			if self.total is None:
				raise Exception("Header 'X-WP-Total' was not found.")
			return self.total

		abstracts_data = self.response.json()

		if isinstance(abstracts_data, dict):
			# only one object was returned; make it a list
			abstracts_data = [abstracts_data]

		abstracts = list()
		for d in abstracts_data:
			# Before we continue, do we have this Abstract in the cache already?
			try:
				abstract = self.api.wordpress_object_cache.get(class_name=Abstract.__name__, key=d["id"])
				abstracts.append(abstract)
				continue
			except WPORMCacheObjectNotFoundError:
				# nope, carry on
				pass

			abstract = Abstract(api=self.api)
			abstract.json = json.dumps(d)

			abstract.update_schema_from_dictionary(d)

			if "_embedded" in d:
				logger.debug("TODO: implement _embedded content for Abstract object")

			# add to cache
# 			self.api.wordpress_object_cache.set(value=abstract, keys=(abstract.s.id, abstract.s.slug))

			abstracts.append(abstract)

		return abstracts

	@property
	def slugs(self):
		'''
		The list of project slugs to retrieve.
		'''
		return self._slugs

	@slugs.setter
	def slugs(self, values):
		if values is None:
			self.parameters.pop("slugs", None)
			self._slugs = list()
			return
		elif not isinstance(values, list):
			raise ValueError("Slugs must be provided as a list (or append to the existing list).")

		for s in values:
			if isinstance(s, str):
				self._slugs.append(s)
			else:
				raise ValueError("Unexpected type for property list 'slugs'; expected str, got '{0}'".format(type(s)))


	@property
	def categories(self):
		return self._category_ids

	@categories.setter
	def categories(self, values):
		'''
		This method validates the categories passed to this request.

		It accepts category ID (integer or string) or the slug value.
		'''
		if values is None:
			self.parameters.pop("categories", None)
			self._category_ids = list()
			return
		elif not isinstance(values, list):
			raise ValueError("Categories must be provided as a list (or append to the existing list).")

		for c in values:
			cat_id = None
			if isinstance(c, Category):
				cat_id = c.s.id
#				self._category_ids.append(str(c.s.id))
			elif isinstance(c, int):
#				self._category_ids.append(str(c))
				cat_id = c
			elif isinstance(c, str):
				try:
					# is this a category ID value?
					cat_id = int(c)
					#self._category_ids.append(str(int(c)))
				except ValueError:
					# not a category ID value, try by slug?
					try:
						category = self.api.category(slug=c)
						cat_id = category.s.id
						#self._category_ids.append(category.s.id)
					except exc.NoEntityFound:
						logger.debug("Asked to find a category with the slug '{0}' but not found.".format(slug))

			# Categories are stored as string ID values.
			#
			self._category_ids.append(str(cat_id))

	@property
	def page(self):
		'''
		Current page of the collection.
		'''
		return self._page

	@page.setter
	def page(self, value):
		#
		# only accept integers or strings that can become integers
		#
		if isinstance(value, int):
			self._page = value
		elif isinstance(value, str):
			try:
				self._page = int(value)
			except ValueError:
				raise ValueError("The 'page' parameter must be an integer, was given '{0}'".format(value))

	@property
	def per_page(self):
		'''
		Maximum number of items to be returned in result set.
		'''
		return self._per_page

	@per_page.setter
	def per_page(self, value):
		# only accept integers or strings that can become integers
		#
		if isinstance(value, int):
			self._per_page = value
		elif isinstance(value, str):
			try:
				self._per_page = int(value)
			except ValueError:
				raise ValueError("The 'per_page' parameter must be an integer, was given '{0}'".format(value))
