
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

class WorkingGroup(WPEntity):

	def __init__(self, id=None, api=None):
		super().__init__(api=api)

		# related objects that need to be cached
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
		return ["id", "title", "content","mission",
				"members",'contact','news','events','logo','images','links']

	@property
	def post_fields(self):
		'''
		Arguments for PROJECT requests.
		'''
		if self._post_fields is None:
			# Note that 'date' is excluded in favor of exclusive use of 'date_gmt'.
			self._post_fields = ["title", "content", "logo",
			"members","contact","news","events","images","links"]
		return self._post_fields

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
	def category_names(self):
		return [x.s.name for x in self.categories]

	@property
	def featured_media(self):
		'''
		Returns the 'Media' object that is the "featured media" for this project.
		'''
		if self._featured_media is None and self.s.featured_media is not None:

			media_id = self.s.featured_media
			if media_id == 0:
				# no featured media for this post entry (this is what WordPress returns)
				self._featured_media = None
			else:
				self._featured_media = self.api.media(id=media_id)
		return self._featured_media



class WorkingGroupRequest(WPRequest):
	'''
	A class that encapsulates requests for WordPress Projects.
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

	def get(self):
		'''
		Returns a list of 'WorkingGroup' objects that match the parameters set in this object.
		'''
		self.url = self.api.base_url + "working_group"

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

		wg_data = self.response.json()

		if isinstance(wg_data, dict):
			# only one object was returned; make it a list
			wg_data = [wg_data]

		working_groups = list()
		for d in wg_data:
			wg = WorkingGroup(api=self.api)
			wg.json = json.dumps(d)

			wg.update_schema_from_dictionary(d)

			if "_embedded" in d:
				logger.debug("TODO: implement _embedded content for WorkingGroup object")

			working_groups.append(wg)

		return working_groups

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
	def after(self):
		'''
		WordPress parameter to return posts after this date.
		'''
		return self._after

	@after.setter
	def after(self, value):
		'''
		Set the WordPress parameter to return posts after this date.
		'''
		# The stored format is a datetime object, even though WordPress requires
		# it to be ISO-8601.
		#
		if value is None:
			self.parameters.pop("after", None)
			self._after = None
		elif isinstance(value, datetime):
			self._after = value
		else:
			raise ValueError("The 'after' property only accepts `datetime` objects.")

	@property
	def before(self):
		'''
		WordPress parameter to return posts before this date.
		'''
		return self._after

	@after.setter
	def before(self, value):
		'''
		Set the WordPress parameter to return posts before this date.
		'''
		# The stored format is a datetime object, even though WordPress requires
		# it to be ISO-8601.
		#
		if value is None:
			self.parameters.pop("before", None)
			self._before = None
		elif isinstance(value, datetime):
			self._before = value
		else:
			raise ValueError("The 'before' property only accepts `datetime` objects.")

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
