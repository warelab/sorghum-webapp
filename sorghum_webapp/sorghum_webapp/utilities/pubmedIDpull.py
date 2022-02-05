from litter_getter import pubmed
# import xml.dom.minidom
import xml.etree.ElementTree as ET

# register with user account
pubmed.connect('68732cb76781df2d9ad6d6197712a42b7108')

def getMetaData(papersToFind):

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
		if root[0].find('Article'):
			if root[0].find('Article').find('Journal'):
				papersToFind[num].s.journal = root[0].find('Article').find('Journal').find('Title').text

		for pubDate in root[1][0].findall('PubMedPubDate'):
			if pubDate.get('PubStatus') == 'pubmed':
				year = pubDate.find('Year').text
				month = pubDate.find('Month').text
				day = pubDate.find('Day').text
				break

		papersToFind[num].s.publication_date = year + "-" + month + "-" + day

		if root[0].find("KeywordList"):
			keywordlist = root[0].find("KeywordList").findall("Keyword")

			kwl =[]

			for word in keywordlist:
				kwl.append((word.text).strip())
			papersToFind[num].s.keywords = ', '.join(kwl)
		else:
			papersToFind[num].s.keywords = 'No keywords in Pubmed'

	return papersToFind
