#!/usr/bin/env python3
"""Load the Global Sorghum Conference 2026 program into WordPress, shaped
exactly like the SICNA 2022 / SICNA 2024 proceedings so the /conferences,
/abstracts and /abstract/<slug> pages pick it up without special cases.

Source
------
The program extracted from pagv3.virtual-meeting.org (gsc2026) into the
"GSC 2026 Program" artifact. Pass either the artifact's saved HTML (the
window.__GSC__ blob is pulled out of it) or that blob saved as JSON.

What gets written (same post types and fields as SICNA)
-------------------------------------------------------
  tag                  "GSC 2026" / gsc-2026. Its slug equals the conference
                       slug; that is how the conference page matches
                       abstracts to a conference.
  organization         "Lubbock, Texas" -- the conference `location`.
  conference           gsc-2026: dates and location only. Sponsors, board
                       members, organizers, slogan and featured image are not
                       in the program and are left for WP admin.
  conference_person    presenting authors, speakers and session chairs.
                       People already in WP (matched by name) are reused.
  conference_session   the program's sessions. Per-room copies of the same
                       Break etc. are collapsed into one row, and room-less
                       sessions with no talks (placeholders duplicated
                       elsewhere in the program) are dropped. A talk that has
                       no abstract (keynotes, plenaries, invited talks)
                       becomes its own session with its speakers as
                       organizers, which is how SICNA 2024 recorded its
                       Welcome and Keynote Address.
  conference_abstract  every abstract except the art and photography
                       competition entries, with the SICNA content layout
                       (Authors / Institutions / sections), the gsc-2026
                       tag, and the session of the talk it was presented in.

Two passes
----------
  plan   - read the program and the live WP records (public REST, no auth)
           and write a manifest of every record to create, with
           cross-references kept symbolic ("@person:2589066"). Nothing is
           sent to WordPress. Review the summary / manifest before applying.

  apply  - create the manifest's records in dependency order, resolving the
           symbolic references to the new post IDs. Every created (or
           updated) ID is saved to --state after each write, so an
           interrupted run resumes where it stopped and a re-run never
           duplicates. A record whose slug already exists in WP is updated
           in place instead of created. The first record of each post type
           is read back and its Pods fields compared with what was sent; if
           WordPress did not store them the run stops, and a re-run (after
           fixing the Pods REST settings) rewrites that post. --dry-run
           shows the plan without writing.

  resend - write the named fields again to records apply already created,
           e.g. after enabling REST writes on a field that was dropped:
             resend --manifest ... --type conference_session --fields organizers

  rollback - move every post recorded in --state to the WP trash
           (recoverable from wp-admin). People and organizations that were
           reused rather than created are never touched. The tag is left in
           place; delete it in wp-admin if wanted.

After apply, refresh the site caches so the new records show up:
  warm_wp_cache.sh https://www.sorghumbase.org

Usage
-----
  python import_gsc2026.py plan --program gsc2026.json --out gsc2026_manifest.json

  SB_WP_USERNAME=... SB_WP_PASSWORD=... \\
    python import_gsc2026.py apply --manifest gsc2026_manifest.json \\
        --state gsc2026_state.json --dry-run
  SB_WP_USERNAME=... SB_WP_PASSWORD=... \\
    python import_gsc2026.py apply --manifest gsc2026_manifest.json \\
        --state gsc2026_state.json
"""

import argparse
import html
import json
import logging
import os
import re
import sys
import unicodedata
from collections import Counter, OrderedDict, defaultdict

import requests
from requests.auth import HTTPBasicAuth

WP_BASE = "https://content.sorghumbase.org/wordpress/index.php/wp-json/wp/v2"

CONFERENCE = {
    "slug": "gsc-2026",
    "title": "Global Sorghum Conference 2026",
    "tag_name": "GSC 2026",
    "start_date": "2026-09-13",
    "end_date": "2026-09-18",
    "location": "Lubbock, Texas",
}

# presentation_type values, kept in the lowercase free-text style SICNA used
# ("talk", "poster", "student oral competition", ...).
TYPE_BY_PROGRAM = {
    "Oral presentation": "talk",
    "Poster presentation": "poster",
    "3-Minute Thesis": "3 minute thesis",
    "Ideation presentation": "idea challenge",
}
# Program code prefixes: GSC = scientific, 3MT = 3 Minute Thesis,
# IC = Idea Challenge, AC = art & photography competition (not imported).
SKIP_CODE_PREFIXES = ("AC",)

# Talk titles that are only placeholders for the speaker's name.
PLACEHOLDER_TALK_TITLES = {"tbd", "speaker"}

POST_TYPES = ("conference_person", "conference_session", "conference_abstract")

log = logging.getLogger("import_gsc2026")


# ---------------------------------------------------------------------------
# Text helpers
# ---------------------------------------------------------------------------

def slugify(text, max_len=90):
    s = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    if len(s) > max_len:
        s = s[:max_len].rsplit("-", 1)[0]
    return s or "untitled"


def name_key(name):
    """Case-, accent- and punctuation-insensitive key for matching people."""
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    return " ".join(re.sub(r"[^a-z0-9 ]+", " ", s.lower()).split())


def first_last_key(name):
    parts = name_key(name).split()
    return f"{parts[0]} {parts[-1]}" if len(parts) > 1 else (parts[0] if parts else "")


def tidy_case(name):
    """The program has some surnames in capitals (ABERA, BROCHET). Title-case
    all-caps words of 4+ letters; leave short ones (FNU, BC, DK) alone."""
    def fix(word):
        letters = re.sub(r"[^A-Za-z]", "", word)
        if len(letters) >= 4 and letters.isupper():
            return "-".join(p.capitalize() for p in word.split("-"))
        return word
    return " ".join(fix(w) for w in name.split())


_INLINE_TAG = re.compile(r"&lt;\s*(/?)\s*(i|em|b|strong|sup|sub|u)\b[^&]*?&gt;", re.I)
_BR_TAG = re.compile(r"&lt;\s*br\b[^&]*?/?\s*&gt;", re.I)


def clean_html(text):
    """Abstract text arrives as pasted HTML: basic inline markup plus Word /
    chat-tool styling attributes, and literal comparisons like "p <0.05".
    Escape everything, then re-enable the inline tags without attributes.
    Single <br>s are line wraps from pasted PDFs and become spaces; a run of
    them is kept as a paragraph break."""
    s = html.escape(html.unescape(text), quote=False)
    s = _INLINE_TAG.sub(lambda m: f"<{m.group(1)}{m.group(2).lower()}>", s)
    s = _BR_TAG.sub("<br/>", s)
    s = re.sub(r"(?:\s*<br/>\s*){2,}", "<br/><br/>", s)
    s = re.sub(r"(?<!<br/>)\s*<br/>\s*(?!<br/>)", " ", s)
    s = re.sub(r"^(?:\s*<br/>)+|(?:<br/>\s*)+$", "", s)
    return re.sub(r"[ \t]+", " ", s).strip()


def plain(text):
    return html.escape(" ".join((text or "").split()), quote=False)


def local_dt(iso):
    """'2026-09-14T09:00:00-05:00' -> '2026-09-14 09:00:00', the naive local
    time the SICNA sessions store (and the browser renders as-is)."""
    return iso[:19].replace("T", " ") if iso else ""


# ---------------------------------------------------------------------------
# Program input
# ---------------------------------------------------------------------------

def load_program(path):
    with open(path, encoding="utf-8") as fh:
        text = fh.read()
    if text.lstrip().startswith("{"):
        return json.loads(text)
    m = re.search(r"window\.__GSC__\s*=\s*(\{.*?\})\s*;?\s*</script>", text, re.S)
    if not m:
        sys.exit(f"{path}: no window.__GSC__ program data found")
    return json.loads(m.group(1))


# ---------------------------------------------------------------------------
# Live WP state (public REST, no auth)
# ---------------------------------------------------------------------------

def wp_get_all(path, params=None):
    items, page = [], 1
    while True:
        resp = requests.get(f"{WP_BASE}/{path}",
                            params={"per_page": 100, "page": page, "orderby": "id",
                                    "order": "asc", **(params or {})},
                            timeout=60)
        resp.raise_for_status()
        items.extend(resp.json())
        if page >= int(resp.headers.get("X-WP-TotalPages", 1)):
            return items
        page += 1


# ---------------------------------------------------------------------------
# plan
# ---------------------------------------------------------------------------

class Planner:
    def __init__(self, program, live):
        self.p = program
        self.live = live
        self.records = OrderedDict()   # key -> record
        self.notes = defaultdict(list)
        self.used_slugs = defaultdict(set)
        for ptype, rows in live.items():
            if ptype in POST_TYPES:
                self.used_slugs[ptype].update(r["slug"] for r in rows)

        self.people = {x["id"]: x for x in program["people"]}
        self.rooms = {x["id"]: x["n"] for x in program["rooms"]}
        self.sessions = {x["id"]: x for x in program["sessions"]}
        self.talks = program["talks"]
        self.abstracts = {x["a"]: x for x in program["abstracts"]}

        # Existing conference_person records, by full name and first+last.
        self.wp_people_full, self.wp_people_fl = {}, {}
        for r in live["conference_person"]:
            full = " ".join(filter(None, [r.get("first_name"), r.get("middle_initial"),
                                          r.get("last_name")])) or r["title"]["rendered"]
            for name in (full, r["title"]["rendered"]):
                self.wp_people_full.setdefault(name_key(name), r["id"])
            self.wp_people_fl.setdefault(
                first_last_key(f"{r.get('first_name') or ''} {r.get('last_name') or ''}"), r["id"])

        # Program people by name, to line abstract authors up with them.
        self.program_people_by_name = {name_key(x["n"]): x["id"] for x in program["people"]}
        # Affiliation per person, taken from any abstract that lists them.
        self.affiliation_by_name = {}
        for ab in program["abstracts"]:
            for au in ab.get("au") or []:
                if au.get("a"):
                    self.affiliation_by_name.setdefault(name_key(au["n"]), au["a"][0])

    # -- helpers -----------------------------------------------------------

    def add(self, key, record):
        self.records[key] = {"key": key, **record}
        return "@" + key

    def unique_slug(self, ptype, base):
        slug, n = base, 2
        while slug in self.used_slugs[ptype]:
            slug, n = f"{base}-{n}", n + 1
        self.used_slugs[ptype].add(slug)
        return slug

    # -- people ------------------------------------------------------------

    def person(self, name, program_id=None, affiliation=None):
        """Return a reference to the conference_person for `name`, reusing a
        WP record when one matches and planning a new one otherwise."""
        if program_id is None:
            program_id = self.program_people_by_name.get(name_key(name))
        prog = self.people.get(program_id) if program_id else None
        if prog:
            name = prog["n"]
        key = f"person:{program_id}" if prog else f"person:{name_key(name)}"
        if key in self.records:
            return "@" + key

        wp_id = (self.wp_people_full.get(name_key(tidy_case(name)))
                 or self.wp_people_fl.get(first_last_key(tidy_case(name))))
        if wp_id:
            self.notes["people reused from WP"].append(f"{name} -> {wp_id}")
            return self.add(key, {"type": "conference_person", "existing_id": wp_id,
                                  "label": name})

        display = tidy_case(name)
        words = display.split()
        if prog and prog.get("sn") and display.lower().endswith(tidy_case(prog["sn"]).lower()):
            last = display[-len(prog["sn"]):]
            given = display[:-len(prog["sn"])].split()
        else:
            last, given = (words[-1], words[:-1]) if len(words) > 1 else (display, [])
        first = given[0] if given else ""
        middle = " ".join(given[1:])

        affiliation = affiliation or self.affiliation_by_name.get(name_key(name), "")
        return self.add(key, {
            "type": "conference_person",
            "slug": self.unique_slug("conference_person", slugify(display)),
            "fields": {
                "title": display,
                "status": "publish",
                "first_name": first,
                "middle_initial": middle,
                "last_name": last,
                "affiliation": affiliation,
                "job_title": "",
                "email": "",
            },
        })

    # -- conference, tag, location -----------------------------------------

    def plan_conference(self):
        c = CONFERENCE
        tag = next((t for t in self.live["tags"] if t["slug"] == c["slug"]), None)
        if tag:
            self.add("tag", {"type": "tag", "existing_id": tag["id"], "label": tag["name"]})
        else:
            self.add("tag", {"type": "tag", "slug": c["slug"],
                             "fields": {"name": c["tag_name"], "slug": c["slug"]}})

        loc = next((o for o in self.live["organization"]
                    if name_key(o["title"]["rendered"]) == name_key(c["location"])), None)
        if loc:
            self.add("location", {"type": "organization", "existing_id": loc["id"],
                                  "label": c["location"]})
        else:
            self.add("location", {
                "type": "organization",
                "slug": slugify(c["location"]),
                "fields": {"title": c["location"], "status": "publish", "plus_code": ""},
            })

        conf = next((x for x in self.live["conference"] if x["slug"] == c["slug"]), None)
        if conf:
            self.add("conference", {"type": "conference", "existing_id": conf["id"],
                                    "label": c["slug"]})
            return
        base = self.p["ev"]["base"]
        self.add("conference", {
            "type": "conference",
            "slug": c["slug"],
            "fields": {
                "title": c["title"],
                "status": "publish",
                "content": (
                    f"<p>The {c['title']} was held in {c['location']}, "
                    f"September 13&ndash;18, 2026. The schedule and abstracts below "
                    f"are imported from the <a href=\"{base}\">official conference "
                    f"program</a>.</p>"),
                "start_date": c["start_date"],
                "end_date": c["end_date"],
                "location": ["@location"],
                "slogan": "",
                "registration_link": "",
            },
        })

    # -- sessions ----------------------------------------------------------

    def plan_sessions(self):
        talks_by_session = defaultdict(list)
        for t in self.talks:
            talks_by_session[t["s"]].append(t)

        groups = OrderedDict()
        for s in sorted(self.p["sessions"], key=lambda s: (s.get("st") or "", s["id"])):
            if not s.get("ti") or not s.get("st"):
                self.notes["sessions dropped (no title or time)"].append(str(s["id"]))
                continue
            if not s.get("r") and not talks_by_session.get(s["id"]):
                # A track slot with no room and no talks is an unfilled
                # placeholder (e.g. Theme 6 on Wednesday); off-site events
                # like the Friday tours carry no track and are kept.
                if s.get("ty"):
                    self.notes["sessions dropped (empty track slot, no room)"].append(
                        f"{s['st'][:16]} {s['ti']}")
                    continue
                self.notes["sessions kept without a room"].append(f"{s['st'][:16]} {s['ti']}")
            groups.setdefault((s["ti"].strip(), s["st"], s.get("en")), []).append(s)

        self.session_ref = {}   # program session id -> @ref
        for (title, st, en), members in groups.items():
            lead = members[0]
            rooms = sorted({self.rooms[m["r"]] for m in members if m.get("r")})
            if len(members) > 1:
                self.notes["sessions merged across rooms"].append(
                    f"{st[:16]} {title} x{len(members)}")
            chairs = [self.person(self.people[p]["n"], p) for p in lead.get("ch") or []]
            ref = self.add(f"session:{lead['id']}", {
                "type": "conference_session",
                "slug": self.unique_slug(
                    "conference_session",
                    f"gsc-2026-{slugify(title, 60)}-{st[5:7]}{st[8:10]}-{st[11:13]}{st[14:16]}"),
                "fields": {
                    "title": f"GSC 2026 {title}",
                    "status": "publish",
                    "conference": "@conference",
                    "session_name": title,
                    "start_time": local_dt(st),
                    "end_time": local_dt(en),
                    "room": rooms[0] if len(rooms) == 1 else "",
                    "organizers": chairs,
                    "organizer_label": ("Chair" if len(chairs) == 1 else "Chairs") if chairs else "",
                },
            })
            for m in members:
                self.session_ref[m["id"]] = ref

    def plan_talk_sessions(self):
        """Talks without an abstract get a session of their own."""
        for t in sorted(self.talks, key=lambda t: (t["st"], t["s"], t["p"])):
            if self.talk_abstract.get(t["i"]) or t["s"] not in self.session_ref:
                continue
            parent = self.sessions[t["s"]]
            speakers = [self.person(self.people[p]["n"], p) for p in t.get("au") or []
                        if p in self.people]
            title = " ".join(t["t"].split())
            if title.lower() in PLACEHOLDER_TALK_TITLES:
                title = "Invited talk"
            lower = title.lower()
            label = ("Moderator" if lower.startswith("moderator")
                     else "Workshop lead" if lower.startswith("workshop lead")
                     else "Speaker" if len(speakers) == 1 else "Speakers") if speakers else ""
            st = t["st"]
            self.add(f"talk:{t['i']}", {
                "type": "conference_session",
                "slug": self.unique_slug(
                    "conference_session",
                    f"gsc-2026-{slugify(title, 60)}-{st[5:7]}{st[8:10]}-{st[11:13]}{st[14:16]}"),
                "fields": {
                    "title": f"GSC 2026 {title}",
                    "status": "publish",
                    "conference": "@conference",
                    "session_name": title,
                    "start_time": local_dt(st),
                    "end_time": local_dt(t.get("en")),
                    "room": self.rooms.get(parent.get("r"), ""),
                    "organizers": speakers,
                    "organizer_label": label,
                },
            })
        self.notes["talks without an abstract, planned as sessions"].append(
            str(sum(1 for k in self.records if k.startswith("talk:"))))

    # -- abstracts ---------------------------------------------------------

    def link_talks(self):
        """abstract id -> talk, and talk id -> abstract id. A talk names its
        abstract (`ab`); an abstract can also name its talk (`tm`)."""
        by_mid = {t["m"]: t for t in self.talks}
        self.abstract_talk, self.talk_abstract = {}, {}
        for t in self.talks:
            if t.get("ab") in self.abstracts:
                self.abstract_talk[t["ab"]] = t
                self.talk_abstract[t["i"]] = t["ab"]
        self.duplicates = set()
        for ab in self.abstracts.values():
            t = by_mid.get(ab.get("tm"))
            if not t or ab["a"] in self.abstract_talk:
                continue
            other = self.talk_abstract.get(t["i"])
            if other and name_key(self.abstracts[other]["t"]) == name_key(ab["t"]):
                # Same title submitted twice for one talk; keep the one the
                # talk points at.
                self.duplicates.add(ab["a"])
                self.notes["duplicate submissions skipped"].append(f"{ab['r']} {ab['t'][:60]}")
            elif not other:
                self.abstract_talk[ab["a"]] = t
                self.talk_abstract[t["i"]] = ab["a"]

    def presentation_type(self, ab, talk):
        if ab["r"].startswith("3MT"):
            return "3 minute thesis"
        if ab["r"].startswith("IC"):
            return "idea challenge"
        if talk:
            # Presented in a talk slot, whatever it was submitted as, unless
            # the slot itself says otherwise.
            return TYPE_BY_PROGRAM.get(talk.get("ty"), "talk")
        return TYPE_BY_PROGRAM.get(ab.get("y"), "poster")

    def content(self, ab):
        """Same layout as the SICNA abstracts: Authors with superscript
        institution numbers, the numbered Institutions, then the text."""
        institutions, parts = [], []
        for au in ab.get("au") or []:
            nums = []
            for aff in au.get("a") or []:
                aff = " ".join(aff.split())
                if aff not in institutions:
                    institutions.append(aff)
                nums.append(str(institutions.index(aff) + 1))
            parts.append(plain(tidy_case(au["n"])) + (f"<sup>{','.join(nums)}</sup>" if nums else ""))
        out = []
        if parts:
            authors = parts[0] if len(parts) == 1 else ", ".join(parts[:-1]) + " and " + parts[-1]
            out.append(f"<p><strong>Authors: </strong>{authors}</p>")
        if institutions:
            listed = ", ".join(f"{i}. {plain(x)}" for i, x in enumerate(institutions, 1))
            out.append(f"<p><strong>Institutions: </strong>{listed}</p>")
        if (ab.get("th") or "").startswith("Theme"):
            out.append(f"<p><strong>Theme: </strong>{plain(ab['th'])}</p>")
        for sec in ab.get("sc") or []:
            body = clean_html(sec["x"])
            if body:
                out.append(f"<p><strong>{plain(sec['h'])}: </strong>{body}</p>")
        return "\n".join(out)

    def plan_abstracts(self):
        def order(ab):
            t = self.abstract_talk.get(ab["a"])
            # Talks first in program order so post IDs follow the agenda;
            # the conference page lists a session's talks in ID order.
            return (0, t["st"], t["s"], t["p"]) if t else (1, "", 0, ab["r"])

        skipped = Counter()
        for ab in sorted(self.abstracts.values(), key=order):
            if ab["r"].startswith(SKIP_CODE_PREFIXES):
                skipped["art & photography competition"] += 1
                continue
            if ab["a"] in self.duplicates:
                continue
            talk = self.abstract_talk.get(ab["a"])
            authors = ab.get("au") or []
            presenter = next((au for au in authors if au.get("p")), authors[0] if authors else None)
            fields = {
                "title": " ".join(ab["t"].split()),
                "status": "publish",
                "content": self.content(ab),
                "presentation_type": self.presentation_type(ab, talk),
                "presenting_author": ([self.person(presenter["n"], None, (presenter.get("a") or [""])[0])]
                                      if presenter else []),
                "tags": ["@tag"],
            }
            if talk and talk["s"] in self.session_ref:
                fields["session"] = self.session_ref[talk["s"]]
            self.add(f"abstract:{ab['a']}", {
                "type": "conference_abstract",
                "slug": self.unique_slug("conference_abstract", slugify(fields["title"])),
                "fields": fields,
            })
        for k, v in skipped.items():
            self.notes["abstracts not imported"].append(f"{k}: {v}")

    def run(self):
        self.plan_conference()
        self.link_talks()
        self.plan_sessions()
        self.plan_talk_sessions()
        self.plan_abstracts()
        # People were planned on first use; move them ahead of the sessions
        # and abstracts that reference them.
        rank = {"tag": 0, "organization": 1, "conference": 2, "conference_person": 3,
                "conference_session": 4, "conference_abstract": 5}
        ordered = sorted(self.records.values(), key=lambda r: rank[r["type"]])
        return {"conference": CONFERENCE, "wp_base": WP_BASE,
                "records": ordered, "notes": self.notes}


def cmd_plan(args):
    program = load_program(args.program)
    log.info("reading live WordPress records from %s", WP_BASE)
    live = {
        "conference": wp_get_all("conference"),
        "conference_person": wp_get_all("conference_person"),
        "conference_session": wp_get_all("conference_session", {"_fields": "id,slug"}),
        "conference_abstract": wp_get_all("conference_abstract", {"_fields": "id,slug"}),
        "organization": wp_get_all("organization", {"_fields": "id,slug,title"}),
        "tags": wp_get_all("tags", {"slug": CONFERENCE["slug"]}),
    }
    manifest = Planner(program, live).run()
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=1, ensure_ascii=False)

    recs = manifest["records"]
    new = Counter(r["type"] for r in recs if "existing_id" not in r)
    reused = Counter(r["type"] for r in recs if "existing_id" in r)
    print(f"wrote {args.out}")
    for t in ("tag", "organization", "conference", "conference_person",
              "conference_session", "conference_abstract"):
        print(f"  {t:20s} create {new[t]:4d}   reuse {reused[t]:3d}")
    types = Counter(r["fields"]["presentation_type"] for r in recs
                    if r["type"] == "conference_abstract")
    print("  presentation_type    " + ", ".join(f"{k} {v}" for k, v in types.most_common()))
    for heading, items in manifest["notes"].items():
        print(f"\n{heading} ({len(items)}):")
        for item in items[:40]:
            print(f"  {item}")
        if len(items) > 40:
            print(f"  ... {len(items) - 40} more")


# ---------------------------------------------------------------------------
# apply / rollback
# ---------------------------------------------------------------------------

REST_PATH = {"tag": "tags", "organization": "organization", "conference": "conference",
             "conference_person": "conference_person",
             "conference_session": "conference_session",
             "conference_abstract": "conference_abstract"}


def wp_error(resp):
    try:
        j = resp.json()
        return f"{resp.status_code} {j.get('code') or ''} {j.get('message') or ''}".strip()
    except ValueError:
        return f"{resp.status_code} {(resp.text or '')[:200]}"


def resolve(value, state):
    if isinstance(value, list):
        return [resolve(v, state) for v in value]
    if isinstance(value, str) and value.startswith("@"):
        key = value[1:]
        if key not in state:
            raise KeyError(key)
        return state[key]
    return value


def find_existing(wp_base, rec, auth):
    path = REST_PATH[rec["type"]]
    params = {"slug": rec["slug"]}
    if rec["type"] != "tag":
        params.update(status="any", context="edit")
    resp = requests.get(f"{wp_base}/{path}", params=params, auth=auth, timeout=60)
    resp.raise_for_status()
    rows = resp.json()
    return rows[0]["id"] if rows else None


def _ids(value):
    """Pods returns a relation as an int, a list of ints, or a list of post
    objects; reduce any of them to a sorted list of ints."""
    if value in (None, "", False):
        return []
    if not isinstance(value, list):
        value = [value]
    out = []
    for v in value:
        if isinstance(v, dict):
            v = v.get("ID") or v.get("id")
        try:
            out.append(int(v))
        except (TypeError, ValueError):
            pass
    return sorted(out)


def verify(wp_base, rec, post_id, sent, auth):
    """Read a freshly created post back and check the Pods fields stuck.
    Pods only stores fields that are enabled for REST writes."""
    resp = requests.get(f"{wp_base}/{REST_PATH[rec['type']]}/{post_id}",
                        params={"context": "edit"}, auth=auth, timeout=60)
    resp.raise_for_status()
    got = resp.json()
    bad = []
    for k, v in sent.items():
        if k in ("title", "status", "content", "slug"):
            continue
        g = got.get(k)
        if isinstance(v, list) or isinstance(g, list) or k in ("conference", "session"):
            ok = _ids(g) == _ids(v)
        else:
            ok = str(g or "") == str(v or "")
        if not ok:
            bad.append(f"{k}: sent {v!r}, stored {g!r}")
    return bad


def cmd_apply(args):
    with open(args.manifest, encoding="utf-8") as fh:
        manifest = json.load(fh)
    wp_base = manifest["wp_base"]
    state = {}
    if os.path.exists(args.state):
        with open(args.state, encoding="utf-8") as fh:
            state = json.load(fh)

    auth = None
    if os.environ.get("SB_WP_USERNAME") and os.environ.get("SB_WP_PASSWORD"):
        auth = HTTPBasicAuth(os.environ["SB_WP_USERNAME"], os.environ["SB_WP_PASSWORD"])
    elif not args.dry_run:
        sys.exit("SB_WP_USERNAME and SB_WP_PASSWORD must be set")

    def save():
        if args.dry_run:
            return
        tmp = args.state + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(state, fh, indent=1)
        os.replace(tmp, args.state)

    created = Counter()
    verified = set()
    state.setdefault("_created", [])
    for rec in manifest["records"]:
        key = rec["key"]
        if key in state:
            continue
        if "existing_id" in rec:
            state[key] = rec["existing_id"]
            save()
            continue

        # A post with this slug is one of ours whose state entry was lost or
        # dropped after a failed check (plan never picks a slug already in
        # use): write the fields to it rather than creating a duplicate.
        existing = find_existing(wp_base, rec, auth) if auth else None

        try:
            fields = {k: resolve(v, state) for k, v in rec["fields"].items()}
        except KeyError as e:
            if args.dry_run:
                fields = rec["fields"]   # the reference would exist after a real run
            else:
                sys.exit(f"{key}: unresolved reference @{e.args[0]}")
        if rec["type"] != "tag":
            fields["slug"] = rec["slug"]

        verb = "update" if existing else "create"
        if args.dry_run:
            created[rec["type"]] += 1
            state[key] = existing or f"<new {rec['type']}>"
            if created[rec["type"]] <= args.show:
                print(f"would {verb} {rec['type']} {rec['slug']}")
                print("  " + json.dumps({k: v for k, v in fields.items() if k != "content"},
                                        ensure_ascii=False)[:600])
            continue

        url = f"{wp_base}/{REST_PATH[rec['type']]}" + (f"/{existing}" if existing else "")
        resp = requests.post(url, json=fields, auth=auth, timeout=120)
        if rec["type"] == "tag" and not resp.ok:
            j = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {}
            if j.get("code") == "term_exists":
                state[key] = int(j["data"]["term_id"])
                save()
                continue
        if not resp.ok:
            save()
            sys.exit(f"{key}: {verb} failed: {wp_error(resp)}")
        post_id = int(resp.json()["id"])
        state[key] = post_id
        if rec["type"] != "tag" and not existing:
            state["_created"].append([rec["type"], post_id])
        save()
        created[rec["type"]] += 1
        log.info("%sd %s %s -> %s", verb, rec["type"], rec["slug"], post_id)

        if rec["type"] not in verified and rec["type"] != "tag":
            bad = verify(wp_base, rec, post_id, fields, auth)
            if bad:
                # Forget it (rollback still has it) so the next run finds it
                # by slug and writes the fields again.
                del state[key]
                save()
                sys.exit(f"{key} (post {post_id}): WordPress did not store these fields:\n  "
                         + "\n  ".join(bad)
                         + "\nEnable REST writes for this post type in Pods, then re-run "
                           "apply; it will fill in this post.")
            verified.add(rec["type"])

    verb = "would create" if args.dry_run else "created"
    print(f"{verb}: " + (", ".join(f"{t} {n}" for t, n in created.items()) or "nothing"))
    if not args.dry_run:
        print("Now refresh the site caches, e.g. warm_wp_cache.sh https://www.sorghumbase.org")


def cmd_resend(args):
    """Write some fields again to records apply already created -- for a
    field that only accepted REST writes after the run (apply checks the
    first record of each type, so a field empty there goes unnoticed).
    Records whose resent fields are all empty are skipped; each write is
    read back, and the run stops at the first that does not stick."""
    if not (os.environ.get("SB_WP_USERNAME") and os.environ.get("SB_WP_PASSWORD")):
        sys.exit("SB_WP_USERNAME and SB_WP_PASSWORD must be set")
    auth = HTTPBasicAuth(os.environ["SB_WP_USERNAME"], os.environ["SB_WP_PASSWORD"])
    with open(args.manifest, encoding="utf-8") as fh:
        manifest = json.load(fh)
    with open(args.state, encoding="utf-8") as fh:
        state = json.load(fh)
    wp_base = manifest["wp_base"]
    names = [f.strip() for f in args.fields.split(",") if f.strip()]

    done = 0
    for rec in manifest["records"]:
        if rec["type"] != args.type or "fields" not in rec or rec["key"] not in state:
            continue
        body = {k: resolve(rec["fields"][k], state) for k in names if k in rec["fields"]}
        if not any(body.values()):
            continue
        post_id = state[rec["key"]]
        if args.dry_run:
            print(f"would resend {rec['type']} {post_id} {json.dumps(body)}")
            done += 1
            continue
        resp = requests.post(f"{wp_base}/{REST_PATH[rec['type']]}/{post_id}", json=body,
                             auth=auth, timeout=120)
        if not resp.ok:
            sys.exit(f"{rec['key']} (post {post_id}): update failed: {wp_error(resp)}")
        bad = verify(wp_base, rec, post_id, body, auth)
        if bad:
            sys.exit(f"{rec['key']} (post {post_id}): WordPress did not store:\n  "
                     + "\n  ".join(bad))
        done += 1
        log.info("resent %s %s -> %s", rec["type"], ",".join(body), post_id)
    print(f"{'would resend' if args.dry_run else 'resent'} {done} {args.type} records")


def cmd_rollback(args):
    if not (os.environ.get("SB_WP_USERNAME") and os.environ.get("SB_WP_PASSWORD")):
        sys.exit("SB_WP_USERNAME and SB_WP_PASSWORD must be set")
    auth = HTTPBasicAuth(os.environ["SB_WP_USERNAME"], os.environ["SB_WP_PASSWORD"])
    with open(args.state, encoding="utf-8") as fh:
        state = json.load(fh)
    created = state.get("_created", [])
    print(f"{'would trash' if args.dry_run else 'trashing'} {len(created)} posts")
    for ptype, post_id in reversed(created):
        if args.dry_run:
            continue
        resp = requests.delete(f"{WP_BASE}/{REST_PATH[ptype]}/{post_id}", auth=auth, timeout=60)
        if not resp.ok and resp.status_code != 410:
            log.warning("%s %s: %s", ptype, post_id, wp_error(resp))
    if not args.dry_run:
        print("Done. The gsc-2026 tag was left in place.")


def main():
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("plan", help="build the manifest (no WP writes)")
    p.add_argument("--program", required=True, help="artifact HTML or extracted JSON")
    p.add_argument("--out", default="gsc2026_manifest.json")
    p.set_defaults(func=cmd_plan)

    p = sub.add_parser("apply", help="create the manifest's records in WordPress")
    p.add_argument("--manifest", required=True)
    p.add_argument("--state", default="gsc2026_state.json")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--show", type=int, default=2, help="records per type to print on --dry-run")
    p.set_defaults(func=cmd_apply)

    p = sub.add_parser("resend", help="write some fields again to records already created")
    p.add_argument("--manifest", required=True)
    p.add_argument("--state", default="gsc2026_state.json")
    p.add_argument("--type", required=True, help="e.g. conference_session")
    p.add_argument("--fields", required=True, help="comma-separated, e.g. organizers")
    p.add_argument("--dry-run", action="store_true")
    p.set_defaults(func=cmd_resend)

    p = sub.add_parser("rollback", help="trash every post created by apply")
    p.add_argument("--state", default="gsc2026_state.json")
    p.add_argument("--dry-run", action="store_true")
    p.set_defaults(func=cmd_rollback)

    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
