from litter_getter import pubmed
# import xml.dom.minidom
import xml.etree.ElementTree as ET

# register with user account
pubmed.connect('4310661ddba8abf80e4be5c7c0850ae71d09')

def getMetaData(papersToFind):
	print("getMetaData???")
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
	print("before enumerate(refs)")
	for num, id in enumerate(refs):
		print("inside", num)
		papersToFind[num].s.abstract = refs[num]['abstract']
		papersToFind[num].s.paper_authors = ', '.join(refs[num]['authors'])
		papersToFind[num].s.title = refs[num]['title']
		papersToFind[num].s.source_url = "https://www.ncbi.nlm.nih.gov/pubmed/" + papersToFind[num].s.pubmed_id
		papersToFind[num].s.doi = refs[num]['doi']
		papersToFind[num].s.abstract = refs[num]['abstract']

		root = ET.fromstring(refs[num]["xml"])
		day = "not a day"
		if root[0].find('Article'):
			if root[0].find('Article').find('Journal'):
				journal = root[0].find('Article').find('Journal')
				papersToFind[num].s.journal = journal.find('Title').text
				pubDate = journal.find('JournalIssue').find('PubDate')
				if pubDate:
					year = pubDate.find('Year').text
					month = pubDate.find('Month').text
					if month in monthLUT:
						month = monthLUT[month]
						day = pubDate.find('Day').text
		if day == "not a day":
			for pubDate in root[1][0].findall('PubMedPubDate'):
				if pubDate.get('PubStatus') == 'pubmed':
					year = pubDate.find('Year').text
					month = pubDate.find('Month').text
					day = pubDate.find('Day').text
					break
				if pubDate.get('PubStatus') == 'accepted':
					year = pubDate.find('Year').text
					month = pubDate.find('Month').text
					day = pubDate.find('Day').text
					break

		papersToFind[num].s.publication_date = year + "-" + month + "-" + day
		papersToFind[num].s.date = year + "-" + month.zfill(2) + "-" + day.zfill(2) + "T00:00:00"
		print("set date", papersToFind[num].s.date, papersToFind[num].s.publication_date)

		if root[0].find("KeywordList"):
			keywordlist = root[0].find("KeywordList").findall("Keyword")

			kwl =[]
			for word in keywordlist:
				if word.text:
					kwl.append((word.text).strip())
			papersToFind[num].s.keywords = ', '.join(kwl)
		else:
			papersToFind[num].s.keywords = 'No keywords in Pubmed'

	return papersToFind
