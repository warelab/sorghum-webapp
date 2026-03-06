from litter_getter import pubmed
import xml.etree.ElementTree as ET
import re
from pprint import pprint

pubmed.connect('4310661ddba8abf80e4be5c7c0850ae71d09')


import re

AFFILIATION_UNIT_HINTS = {
    "department", "dept", "division", "program", "center", "centre", "lab",
    "laboratory", "unit", "section", "school of", "faculty of", "branch",
    "service", "office"
}

INSTITUTION_HINTS = {
    "university", "college", "hospital", "institut", "institute",
    "academy", "school", "medical center", "medical centre",
    "clinic", "foundation", "nih", "cdc", "usda", "cnrs", "inserm",
    "department of agriculture", "agricultural research service",
    "ministry", "government", "national institute", "national institutes",
    "research service"
}

COUNTRY_HINTS = {
    "usa", "united states", "uk", "united kingdom", "china", "japan",
    "canada", "france", "germany", "italy", "spain", "australia",
    "india", "brazil", "switzerland", "netherlands", "tunisia",
    "turkey", "morocco", "egypt"
}


def normalize_space(text):
    if not text:
        return ""
    return re.sub(r"\s+", " ", text).strip()


def dedupe_preserve_order(items):
    seen = set()
    out = []
    for item in items:
        key = item.lower() if isinstance(item, str) else str(item).lower()
        if key not in seen and item:
            seen.add(key)
            out.append(item)
    return out


def is_email_chunk(text):
    return bool(re.search(r'[\w\.-]+@[\w\.-]+\.\w+', text or ""))


def is_country_chunk(text):
    low = normalize_space(text).lower().strip(".")
    return low in COUNTRY_HINTS


def is_state_zip_chunk(text):
    # Examples: GA 30605, NY 10032, CA, 10032
    text = normalize_space(text)
    if re.fullmatch(r"[A-Z]{2}\s+\d{5}(?:-\d{4})?", text):
        return True
    if re.fullmatch(r"[A-Z]{2}", text):
        return True
    if re.fullmatch(r"\d{5}(?:-\d{4})?", text):
        return True
    return False


def is_location_like(text):
    text = normalize_space(text)
    low = text.lower()

    if not text:
        return True
    if is_country_chunk(text):
        return True
    if is_state_zip_chunk(text):
        return True

    # City/state/country-ish chunk, often short and without org keywords
    if re.search(r"\b[A-Z]{2}\b", text) and re.search(r"\d{5}", text):
        return True

    # Very short place-like chunks without institution hints
    if len(text.split()) <= 3 and not any(h in low for h in INSTITUTION_HINTS | AFFILIATION_UNIT_HINTS):
        # catches many city-only chunks like "Athens"
        return True

    return False


def classify_affiliation_part(part):
    low = part.lower()

    if is_location_like(part):
        return "location"

    has_unit = any(hint in low for hint in AFFILIATION_UNIT_HINTS)
    has_inst = any(hint in low for hint in INSTITUTION_HINTS)

    # If it contains a strong institution phrase, call it institution
    if has_inst:
        return "institution"

    # Otherwise if it looks like a lab/center/division/etc., call it subunit
    if has_unit:
        return "subunit"

    # Fallback: org-like chunk if it's not location
    return "other_org"

def split_trailing_abbrev(name):
    """
    Split a trailing parenthetical abbreviation from an institution name.

    Examples:
      'United States Department of Agriculture-Agricultural Research Service (USDA-ARS)'
        -> ('United States Department of Agriculture-Agricultural Research Service', 'USDA-ARS')

      'Harvard University'
        -> ('Harvard University', None)
    """
    if not name:
        return None, None

    name = normalize_space(name)

    m = re.match(r"^(.*?)(?:\s*\(([^()]{2,30})\))$", name)
    if not m:
        return name, None

    base = m.group(1).strip(" ,;")
    abbrev = m.group(2).strip()

    # only treat it as an abbreviation if it looks abbreviation-like
    if re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.\-/& ]{1,29}", abbrev):
        return base, abbrev

    return name, None

def split_affiliation(raw_affil):
    raw_affil = normalize_space(raw_affil)
    if not raw_affil:
        return {
            "raw": "",
            "institution": None,
            "institution_abbrev": None,
            "subunit": None,
            "country": None,
            "email": None
        }

    email_match = re.search(r'[\w\.-]+@[\w\.-]+\.\w+', raw_affil)
    email = email_match.group(0) if email_match else None
    affil_wo_email = raw_affil.replace(email, "").strip(" .;,") if email else raw_affil

    parts = [p.strip(" .;") for p in affil_wo_email.split(",") if p.strip(" .;")]
    if not parts:
        return {
            "raw": raw_affil,
            "institution": None,
            "institution_abbrev": None,
            "subunit": None,
            "country": None,
            "email": email
        }

    country = parts[-1] if parts and is_country_chunk(parts[-1]) else None

    classified = [(part, classify_affiliation_part(part)) for part in parts]

    institution_candidates = [part for part, kind in classified if kind == "institution"]
    subunit_candidates = [part for part, kind in classified if kind == "subunit"]
    other_org_candidates = [part for part, kind in classified if kind == "other_org"]

    institution = None
    if institution_candidates:
        institution = institution_candidates[-1]
    elif other_org_candidates:
        institution = other_org_candidates[-1]

    subunits = list(subunit_candidates)

    if institution:
        for part, kind in classified:
            if part == institution:
                break
            if kind in {"institution", "subunit", "other_org"} and not is_location_like(part):
                subunits.append(part)

    subunits = dedupe_preserve_order([s for s in subunits if s != institution])

    institution_name, institution_abbrev = split_trailing_abbrev(institution)

    return {
        "raw": raw_affil,
        "institution": institution_name,
        "institution_abbrev": institution_abbrev,
        "subunit": "; ".join(subunits) if subunits else None,
        "country": country,
        "email": email
    }

def parse_affiliations(article_root):
    """
    Extract a unique parsed list of affiliations from:
    MedlineCitation/Article/AuthorList/Author/AffiliationInfo/Affiliation
    """
    affiliations = []
    parsed_affiliations = []

    article = article_root[0].find("Article")
    if article is None:
        return [], []

    author_list = article.find("AuthorList")
    if author_list is None:
        return [], []

    for author in author_list.findall("Author"):
        for aff_info in author.findall("AffiliationInfo"):
            aff = aff_info.find("Affiliation")
            if aff is not None and aff.text:
                raw = normalize_space(aff.text)
                affiliations.append(raw)
                parsed_affiliations.append(split_affiliation(raw))

    unique_raw = dedupe_preserve_order(affiliations)

    # dedupe parsed by raw text
    seen = set()
    unique_parsed = []
    for item in parsed_affiliations:
        key = item["raw"].lower()
        if key not in seen:
            seen.add(key)
            unique_parsed.append(item)

    return unique_raw, unique_parsed

def print_tree(elem, level=0, max_text=80):
    indent = "  " * level
    text = (elem.text or "").strip()
    if len(text) > max_text:
        text = text[:max_text] + "..."
    print(f"{indent}{elem.tag} {elem.attrib} {text}")
    for child in elem:
        print_tree(child, level + 1, max_text=max_text)


STOPWORDS_FOR_ACRONYM = {
    "of", "and", "the", "for", "in", "on", "to", "at", "by", "de", "du", "la"
}

def split_name_and_acronym(text):
    """
    Split a trailing parenthetical acronym from a name.
    """
    text = normalize_space(text)
    if not text:
        return None, None

    m = re.match(r"^(.*?)(?:\s*\(([^()]{2,40})\))$", text)
    if not m:
        return text, None

    base = m.group(1).strip(" ,;")
    paren = m.group(2).strip()

    if re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.\- /&]{1,39}", paren):
        return base, paren

    return text, None


def extract_acronym_from_agency(text):
    """
    Extract acronym-like text from any parenthetical in agency string.
    Removes the parenthetical from the agency name if used.
    """
    text = normalize_space(text)
    if not text:
        return None, None

    matches = re.findall(r"\(([^()]{2,40})\)", text)
    acronym = None

    for m in matches:
        candidate = m.strip()
        if re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.\- /&]{1,39}", candidate):
            acronym = candidate
            text = re.sub(r"\s*\(" + re.escape(m) + r"\)", "", text, count=1)
            text = normalize_space(text).strip(" ,;")
            break

    return text, acronym


def fake_acronym_from_agency(agency):
    """
    Best-effort acronym generator from agency name.

    Examples:
      National Institutes of Health -> NIH
      United States Department of Agriculture -> USDA
      Agricultural Research Service -> ARS
      U.S. Department of Agriculture -> USDA
    """
    agency = normalize_space(agency)
    if not agency:
        return None

    # normalize punctuation a bit
    cleaned = agency.replace("&", " and ")
    cleaned = re.sub(r"[/,\-]+", " ", cleaned)
    cleaned = re.sub(r"\bU\.S\.\b", "US", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\bU\.K\.\b", "UK", cleaned, flags=re.IGNORECASE)
    cleaned = normalize_space(cleaned)

    words = cleaned.split()
    acronym_parts = []

    for word in words:
        bare = re.sub(r"^[^A-Za-z0-9]+|[^A-Za-z0-9]+$", "", word)
        if not bare:
            continue

        low = bare.lower()
        if low in STOPWORDS_FOR_ACRONYM:
            continue

        # keep all-caps short tokens as-is, e.g. NIH, USDA, CNRS
        if re.fullmatch(r"[A-Z0-9]{2,6}", bare):
            acronym_parts.append(bare)
            continue

        # camel-ish / mixed-case token: take capitals if present
        caps = "".join(ch for ch in bare if ch.isupper())
        if len(caps) >= 2:
            acronym_parts.append(caps)
            continue

        # otherwise use first letter of normal titlecase/word
        if bare[0].isalpha():
            acronym_parts.append(bare[0].upper())

    acronym = "".join(acronym_parts)

    # avoid garbage outputs
    if len(acronym) < 2:
        return None
    if len(acronym) > 12:
        return acronym[:12]

    return acronym

def parse_funding(article_root):
    """
    Extract funding from:
    MedlineCitation/GrantList/Grant
    """
    funding_records = []
    agencies = []

    article = article_root[0].find("Article")
    if article is None:
        return [], []

    grant_list = article.find("GrantList")
    if grant_list is None:
        return [], []

    for grant in grant_list.findall("Grant"):
        agency = normalize_space(grant.findtext("Agency"))
        grant_id = normalize_space(grant.findtext("GrantID"))
        acronym = normalize_space(grant.findtext("Acronym"))
        country = normalize_space(grant.findtext("Country"))

        extracted_acronym = None

        # 1. Try extracting from agency parentheses if no acronym provided
        if agency and not acronym:
            agency, extracted_acronym = extract_acronym_from_agency(agency)

        # 2. If still nothing, fake one from capitalized letters / words
        if agency and not acronym and not extracted_acronym:
            extracted_acronym = fake_acronym_from_agency(agency)

        final_acronym = acronym or extracted_acronym

        record = {
            "agency": agency or None,
            "grant_id": grant_id or None,
            "acronym": final_acronym or None,
            "country": country or None
        }

        funding_records.append(record)

        if agency:
            agencies.append(agency)

    unique_agencies = dedupe_preserve_order(agencies)

    seen = set()
    unique_records = []
    for rec in funding_records:
        key = (
            (rec["agency"] or "").lower(),
            (rec["grant_id"] or "").lower(),
            (rec["acronym"] or "").lower(),
            (rec["country"] or "").lower()
        )
        if key not in seen:
            seen.add(key)
            unique_records.append(rec)

    return unique_agencies, unique_records

def getMetaData(papersToFind):
    monthLUT = {
        'Jan': '01',
        'Feb': '02',
        'Mar': '03',
        'Apr': '04',
        'May': '05',
        'Jun': '06',
        'Jul': '07',
        'Aug': '08',
        'Sep': '09',
        'Oct': '10',
        'Nov': '11',
        'Dec': '12'
    }

    ids = []
    for paper in papersToFind:
        ids.append(paper.s.pubmed_id)

    fetch = pubmed.PubMedFetch(id_list=ids)
    refs = fetch.get_content()

    for num, id in enumerate(refs):
        papersToFind[num].s.abstract = refs[num]['abstract']
        papersToFind[num].s.paper_authors = ', '.join(refs[num]['authors'])
        papersToFind[num].s.title = refs[num]['title']
        papersToFind[num].s.source_url = "https://www.ncbi.nlm.nih.gov/pubmed/" + papersToFind[num].s.pubmed_id
        papersToFind[num].s.doi = refs[num]['doi']
        papersToFind[num].s.abstract = refs[num]['abstract']

        root = ET.fromstring(refs[num]["xml"])

        # NEW: affiliations + funding
        raw_affiliations, parsed_affiliations = parse_affiliations(root)
        funding_agencies, funding_records = parse_funding(root)

        papersToFind[num].s.affiliations = raw_affiliations
#         papersToFind[num].s.affiliations_parsed = parsed_affiliations

        # convenience lists
#         papersToFind[num].s.affiliation_institutions = dedupe_preserve_order(
#             [x["institution"] for x in parsed_affiliations if x["institution"]]
#         )
#         papersToFind[num].s.affiliation_subunits = dedupe_preserve_order(
#             [x["subunit"] for x in parsed_affiliations if x["subunit"]]
#         )

        papersToFind[num].s.funding_agencies = funding_agencies
#         papersToFind[num].s.funding_records = funding_records
#         papersToFind[num].s.grant_ids = dedupe_preserve_order(
#             [x["grant_id"] for x in funding_records if x["grant_id"]]
#         )
        day = "not a day"
        if root[0].find('Article'):
            if root[0].find('Article').find('Journal'):
                journal = root[0].find('Article').find('Journal')
                papersToFind[num].s.journal = journal.find('Title').text
                pubDate = journal.find('JournalIssue').find('PubDate')
                if pubDate:
                    yearElem = pubDate.find('Year')
                    monthElem = pubDate.find('Month')
                    dayElem = pubDate.find('Day')
                    if yearElem is not None and monthElem is not None and dayElem is not None:
                        year = yearElem.text
                        month = monthElem.text
                        day = dayElem.text
                        if month in monthLUT:
                            month = monthLUT[month]

        if day == "not a day":
            for pubDate in root[1][0].findall('PubMedPubDate'):
                if pubDate.get('PubStatus') == 'pubmed':
                    year = pubDate.find('Year').text
                    month = pubDate.find('Month').text
                    dayElem = pubDate.find('Day')
                    if dayElem is not None:
                        day = dayElem.text
                    else:
                        day = '01'
                    break
                if pubDate.get('PubStatus') == 'accepted':
                    year = pubDate.find('Year').text
                    month = pubDate.find('Month').text
                    dayElem = pubDate.find('Day')
                    if dayElem is not None:
                        day = dayElem.text
                    else:
                        day = '01'
                    break

        papersToFind[num].s.publication_date = year + "-" + month + "-" + day
        papersToFind[num].s.date = year + "-" + month.zfill(2) + "-" + day.zfill(2) + "T00:00:00"
        print("set date", papersToFind[num].s.date, papersToFind[num].s.publication_date)

        if root[0].find("KeywordList"):
            keywordlist = root[0].find("KeywordList").findall("Keyword")
            kwl = []
            for word in keywordlist:
                if word.text:
                    kwl.append((word.text).strip())
            papersToFind[num].s.keywords = ', '.join(kwl)
        else:
            papersToFind[num].s.keywords = 'No keywords in Pubmed'

    return papersToFind
