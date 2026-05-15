"""Gunicorn entry point.

Usage:
    cd /opt/sorghum-webapp/sorghum_webapp/
    gunicorn -w 4 -b 127.0.0.1:8000 wsgi:app

Unlike run_sorghum_webapp.py this module doesn't parse sys.argv, so it
plays nice with whatever flags Gunicorn (or any other WSGI server) was
launched with.
"""

from sorghum_webapp import create_app

app = create_app(debug=False)
