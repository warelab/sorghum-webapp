"""Stub media object backed by local static files.

Replaces ``api.media(slug=...)`` lookups for page banner images. Each banner
the site uses has a JPG checked in under ``static/images/banners/``; this
module returns a small object that templates can render with the same
``{{ banner_media.s.source_url }}`` access they used for real WP Media
objects, so no template changes are needed.
"""

from types import SimpleNamespace

# Slug -> path under /static. Add a new slug here after dropping the JPG
# into static/images/banners/.
_LOCAL_BANNERS = {
    "aerial_combines":                  "/static/images/banners/aerial_combines.jpg",
    "sorghum_combine":                  "/static/images/banners/sorghum_combine.jpg",
    "k-state-sorghum-field-1920x1000":  "/static/images/banners/k-state-sorghum-field-1920x1000.jpg",
    "sorghum_panicle":                  "/static/images/banners/sorghum_panicle.jpg",
    "sorghum-grains_1920x1000":         "/static/images/banners/sorghum-grains_1920x1000.jpg",
}


def local_banner(slug):
    """Return a stub with ``.s.source_url`` pointing at a local banner JPG.

    Raises KeyError for unknown slugs so missing assets fail loudly during
    development rather than silently rendering a broken image.
    """
    return SimpleNamespace(s=SimpleNamespace(source_url=_LOCAL_BANNERS[slug]))
