import logging
app_logger = logging.getLogger("sorghumbase")

def make_menu(label, style='simple'):
    return { 'label':label, 'style':style, 'links':[] }

def add_link(menu, label, link, links=[]):
    if links:
        menu['links'].append({'label':label, 'links':links})
    else:
        menu['links'].append({'label':label, 'link':link})

def news():
    menu = make_menu('News')
    add_link(menu, 'News', '/posts?categories=news,research-highlights')
    add_link(menu, 'Meetings & Events', '/events')
#     add_link(menu, 'Job Postings', '/jobs')
#     add_link(menu, 'Publications', '/publications')
    add_link(menu, 'Release Notes', '/relnotes')
    return menu

def engage():
    menu = make_menu('Engage')
#     add_link(menu, 'Research Notes', '/posts?categories=researchnote')
    add_link(menu, 'Training Materials', '/guides')
#     add_link(menu, 'Videos', 'https://www.youtube.com/channel/UCXpgZNk1JDIn0-7AaS4EBxQ')
#     add_link(menu, 'Office Hours', '/office_hours')
    add_link(menu, 'Mailing List', '/mailing_list')
    add_link(menu, 'Contact Us', '/contact')
    return menu

def genomes():
    ensemblURL = 'https://ensembl.sorghumbase.org'
    genomes = make_menu('Data Access')

    add_link(genomes, 'Species table','/'.join([ensemblURL,'species.html']))
    add_link(genomes, 'Phylogenetic overview','https://ensembl.sorghumbase.org/prot_tree_stats.html')
    add_link(genomes, 'FTP site','https://ftp.sorghumbase.org')

    cpnam = [
        {'prod_name':'Sorghum_chineseamber','label':'ChineseAmber'},
        {'prod_name':'Sorghum_grassl','label':'Grassl'},
        {'prod_name':'Sorghum_leoti','label':'Leoti'},
        {'prod_name':'Sorghum_rio','label':'Rio'},
        {'prod_name':'Sorghum_riouncc','label':'Rio (UNCC)'},
        {'prod_name':'Sorghum_pi229841','label':'PI 229841'},
        {'prod_name':'Sorghum_pi297155','label':'PI 297155'},
        {'prod_name':'Sorghum_pi329311','label':'PI 329311'},
        {'prod_name':'Sorghum_pi506069','label':'PI 506069'},
        {'prod_name':'Sorghum_pi510757','label':'PI 510757'},
        {'prod_name':'Sorghum_pi655972','label':'PI 655972'}
    ]

    pages1 = [
        {'prod_name':'Sorghum_bicolor','label':'BTx623'},
        {'prod_name':'Sorghum_tx430nano','label':'Tx430'},
        {'prod_name':'Sorghum_tx436pac','label':'Tx436'},
        {'prod_name':'Sorghum_tx2783pac','label':'Tx2783'}
    ]
    pages2 = [
        {'prod_name':'Sorghum_is12661','label':'IS12661'},
        {'prod_name':'Sorghum_is36143','label':'IS36143'},
        {'prod_name':'Sorghum_is8525','label':'IS8525'},
        {'prod_name':'Sorghum_is929','label':'IS929'},
        {'prod_name':'Sorghum_ji2731','label':'Ji2731'},
        {'prod_name':'Sorghum_r93194522','label':'R931945-2-2'},
        {'prod_name':'Sorghum_is19953','label':'IS19953'},
        {'prod_name':'Sorghum_pi525695','label':'PI 525695'},
        {'prod_name':'Sorghum_pi532566','label':'PI 532566'},
        {'prod_name':'Sorghum_pi536008','label':'PI 536008'},
        {'prod_name':'Sorghum_austrcf317961','label':'AusTRCF317961'},
        {'prod_name':'Sorghum_353','label':'353'},
        {'prod_name':'Sorghum_s3691','label':'S369-1'}
    ]

    ref1 = make_menu('Reference')
    for page in pages1:
        linkPair = [
            {'label':'browser','link':'/'.join([ensemblURL,page["prod_name"]])},
            {'label':'genome info','link':'/'.join([ensemblURL,page["prod_name"],'Info/Annotation'])}
        ]
#         add_link(ref1, page["label"], 'na', linkPair)
        add_link(ref1, page["label"], '/'.join([ensemblURL,page["prod_name"],'Info/Annotation']))
    ref2 = make_menu('Reference')
    for page in pages2:
        linkPair = [
            {'label':'browser','link':'/'.join([ensemblURL,page["prod_name"]])},
            {'label':'genome info','link':'/'.join([ensemblURL,page["prod_name"],'Info/Annotation'])}
        ]
#         add_link(ref2, page["label"], 'na', linkPair)
        add_link(ref2, page["label"], '/'.join([ensemblURL,page["prod_name"],'Info/Annotation']))

    cpnammenu = make_menu('CP-NAM')
    for page in cpnam:
        linkPair = [
            {'label':'browser','link':'/'.join([ensemblURL,page["prod_name"]])},
            {'label':'genome info','link':'/'.join([ensemblURL,page["prod_name"],'Info/Annotation'])}
        ]
#         add_link(cpnammenu, page["label"], 'na', linkPair)
        add_link(cpnammenu, page["label"], '/'.join([ensemblURL,page["prod_name"],'Info/Annotation']))

    menu = make_menu('Genomes','mega')
    menu['categories'] = [cpnammenu, ref2, ref1, genomes]
    return menu

def germplasm():
    ref = make_menu('Reference')
    add_link(ref, 'PI 564163 - BTx623', '/accession/btx623')
    add_link(ref, 'PI 651496 - Rio', '/accession/rio')
    add_link(ref, 'PI 655996 - Tx430', '/accession/rtx430')
    add_link(ref, 'PI 561071 - Tx436', '/accession/rtx436')
    add_link(ref, 'PI 656001 - Tx2783', '/accession/tx2783')

    reseq = make_menu('Resequencing')


    association = make_menu('Association Panels')
    add_link(association, 'World Core Collection', '/population/world-core')
    add_link(association, 'Mini Core Collection', '/population/mini-core')
    add_link(association, 'Sorghum Association Panel', '/population/sap')
    add_link(association, 'Bioenergy Association Panel', '/population/bap')
    add_link(association, 'SCP + Exotic parents', '/population/scp-exotic')
    add_link(association, 'Expanded SCP Lines', '/population/expanded-scp')
    add_link(association, 'Nigerian Diversity Panel', '/population/nigeria-div')

    other = make_menu('EMS/NAM Populations')
    add_link(other, 'Xin EMS', '/population/xin-ems')
    add_link(other, 'Weil EMS', '/population/weil-ems')
    add_link(other, 'Klein BC-NAM', '/population/klein-nam')
    add_link(other, 'Kresovich NAM', '/population/kresovich-nam')
    add_link(other, 'Mace BC-NAM', '/population/mace-nam')

    menu = make_menu('Germplasm','mega')
    menu['categories'] = [ref, association, other, reseq]

    return menu

# def learn():
#     menu = make_menu('Learn')
#     add_link(menu, 'Tutorials (workflows)', '/#')
#     add_link(menu, 'Webinars', '/#')
#     add_link(menu, 'FAQ', '/#')
#
#     return menu

def tools():
   menu = make_menu('Tools')
   add_link(menu, 'Gene Search','/genes')
   add_link(menu, 'Genome Browser','https://ensembl.sorghumbase.org')
   add_link(menu, 'BLAST','https://ensembl.sorghumbase.org/Tools/Blast')
   return menu

def community_resources():
    projects = make_menu('Projects')
    add_link(projects, 'EMS', '#')
    add_link(projects, 'Sequencing projects - SAP', '#')

    databases = make_menu('Databases')
    add_link(databases, 'NCBI GEO', 'https://www.ncbi.nlm.nih.gov/gds')
    add_link(databases, 'SorghumFDB', 'http://structuralbiology.cau.edu.cn/sorghum/index.html')
    add_link(databases, 'Grassius', 'http://grassius.org/grasstfdb.php')
    add_link(databases, 'GrainGenes', 'https://wheat.pw.usda.gov/GG3/')
    add_link(databases, 'GRIN Global', 'https://npgsweb.ars-grin.gov/gringlobal/search.aspx')
    add_link(databases, 'Crop-PAL2', 'http://crop-pal.org/')
    add_link(databases, 'OZ Sorghum', 'https://aussorgm.org.au/')
    add_link(databases, 'Morokoshi Sorghum Transcriptome', 'http://sorghum.riken.jp/morokoshi/Home.html')

#     tools = make_menu('Tools')

    platforms = make_menu('continued')
    add_link(platforms, 'Gramene', 'http://www.gramene.org')
    add_link(platforms, 'CyVerse', 'http://datacommons.cyverse.org/')
    add_link(platforms, 'SciApps', 'https://www.sciapps.org/')
    add_link(platforms, 'AgriGO', 'http://bioinfo.cau.edu.cn/agriGO/')
    add_link(platforms, 'AgBioData', 'https://www.agbiodata.org/')
    add_link(platforms, 'JGI Phytozome', 'https://phytozome.jgi.doe.gov/pz/portal.html#!info?alias=Org_Sbicolor')
    add_link(platforms, 'MaizeGDB', 'https://www.maizegdb.org/')

    menu = make_menu('Community Resources','mega')
    menu['categories'] = [projects, databases, platforms, research]
    return menu

def research():
    menu = make_menu('Research')
    add_link(menu, 'Publications', '/publications')
    add_link(menu, 'Highlighted Papers', '/posts?categories=research-highlights')
#     add_link(menu, "Funded Projects", '/projects')
    return menu

# def resources():
#     menu = make_menu('Community Resources')
#     add_link(menu, 'Links', '/resource_links')
#     add_link(menu, 'Tools', '/posts?categories=tools')
#     add_link(menu, 'Tutorials', '/posts?categories=tutorials')
#     add_link(menu, 'Projects', '/projects')
#     return menu

def about():
    menu = make_menu('About')
#     add_link(menu, 'Mission Statement', '/mission-statement')
    add_link(menu, 'Team', '/people')
    add_link(menu, 'Contact Us', '/contact')
    add_link(menu, 'Cite SorghumBase', 'paper/10-1007-s00425-022-03821-6')
#     add_link(menu, 'FAQ', '/faq')
#     add_link(menu, 'Feedback', '/feedback')
    return menu

def support():
    menu = make_menu('Support')
    add_link(menu, 'New to SorghumBase', '#')
    add_link(menu, 'Troubleshooting', '#')
    add_link(menu, 'Help Board', '#')
    return menu

def navbar_template(activemenu='NA'):
    return {'navbar': [news(), engage(), genomes(), tools(), research(), about()],'activemenu':activemenu}
#     return {'navbar': [news(), engage(), germplasm(), tools(), community_resources(), about()],'activemenu':activemenu}
