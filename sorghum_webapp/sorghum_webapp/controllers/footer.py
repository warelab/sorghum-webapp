"""Footer template helper.

This function used to fetch latest-news posts and run a photographer-dedup
pass over a ``photos_to_credit`` list so the footer could show photo
credits. Neither output (``footer_latest_news``, ``photos_to_credit``) is
referenced by any template, so the helper is now a no-op. The signature
is preserved so existing callers don't need to change.
"""


def populate_footer_template(template_dictionary=None, wp_api=None, photos_to_credit=None):
	if template_dictionary is None:
		raise Exception("A template dictionary must be provided.")
	# Intentionally no work: prior outputs are unused by any template, and
	# the WordPress requests they triggered were a per-pageview slowdown.
	return
