import React from 'react'
import { Provider, connect } from 'redux-bundler-react'
import { Table, Accordion } from 'react-bootstrap'
import {AgGridReact} from "ag-grid-react";

const About = () => {
  return <Accordion.Item eventKey="about-wg">
    <Accordion.Header><h2>Working Groups</h2></Accordion.Header>
    <Accordion.Body>SorghumBase is coordinating with community members in various areas</Accordion.Body>
  </Accordion.Item>
};
const Members = props => {

}
const WorkingGroup = props => {
  const wg = props.workingGroup;
  const members = wg.members.map(m => props.people[m]);
  const contact = props.people[wg.contact[0]];
  return <Accordion.Item eventKey={wg.id}>
    <Accordion.Header>
      <h2 className="mb20">{wg.logo && <img src={wg.logo.guid} style={{maxHeight:"1em"}}/>}{wg.title.rendered}</h2>
    </Accordion.Header>
    <Accordion.Body>
      <h3>{wg.mission}</h3>
      { members &&
        <div className='card mb10'>
          <div className='card-header' role='tab' id='links'>
            <h5 className='mb-0'>Members</h5>
          </div>
          <div className='card-body'>

            <table className="table table-hover">
            <thead>
            <tr>
              <th>Name</th>
              <th>Affiliation</th>
            </tr>
            </thead>
            {members.map((member, i) => {
              return <tr key={i} className="masonry-title mb1">
                <td>{member.title.rendered}</td>
                <td>{member.affiliation.length > 0 ? member.affiliation.join(', ') : "MISSING INSTITUTION"}</td>
              </tr>
            })}
          </table>
          <h5>For inquiries about this working group contact <a style={{color:'#9F3D34'}} href={`mailto:${contact.email}`}>{contact.title.rendered}</a>.</h5>
          </div>
        </div>
      }
        <div dangerouslySetInnerHTML={{__html: wg.content.rendered}}></div>
      { wg.links &&
        <div className='card mb10'>
          <div className='card-header' role='tab' id='links'>
            <h5 className='mb-0'>Links</h5>
          </div>
          <div className='card-body'>
            {wg.links.map((link, i) => {
              return <h6 key={i} className="masonry-title mb1"><a style={{color:'#9F3D34'}} href={link.resource_url}>
                {link.post_title}
              </a></h6>
            })}
          </div>
        </div>
      }
      { wg.news &&
        <div className='card mb10'>
          <div className='card-header' role='tab' id='posts'>
            <h5 className='mb-0'>News</h5>
          </div>
          <div className='card-body'>
            {wg.news.map((post, i) => {
              return <h6 key={i} className="masonry-title mb1"><a style={{color:'#9F3D34'}} href={`/post/${post.post_name}`}>
                {post.post_title}
              </a></h6>
            })}
          </div>
        </div>
      }
  <br/>
    { wg.images &&
      <div className='card mb10'>
        <div className='card-header' role='tab' id='images'>
          <h5 className='mb-0'>Images</h5>
        </div>
        <div className='card-body'>
          <div className='row'>
            {wg.images.map((image, i) => {
                return (
                  <div className='col-md-4'>
                    <div className='card mb30'>
                      <a href={image.guid} target='_blank' rel='noopener noreferrer'>
                        <img className='card-img-top img-fluid' src={image.guid} alt={image.post_title} />
                      </a>
                      <div className='card-body'>
                        <p className='card-text'>{image.post_excerpt}</p>
                      </div>
                    </div>
                  </div>
                )
            })}
          </div>
        </div>
      </div>
    }

    </Accordion.Body>
  </Accordion.Item>
}

const WorkingGroupsListCmp = props => {
  if (props.sorghumWorkingGroups && props.sorghumPeople) {
    return <div>
      <Accordion defaultActiveKey={['about-wg']} flush alwaysOpen={true}>
        {/*<About/>*/}
        {props.sorghumWorkingGroups.map((workingGroup, idx) =>
          <WorkingGroup key={idx}
                        workingGroup={workingGroup}
                        people={props.sorghumPeople}/>)}
      </Accordion>
    </div>
  }
  return <code>loading...</code>
}

const WorkingGroupsList = connect(
  'selectSorghumWorkingGroups',
  'selectSorghumPeople',
  WorkingGroupsListCmp
)

const WorkingGroups = (store) => {
  return (
    <Provider store={store}>
      <WorkingGroupsList/>
    </Provider>
  )
};

export default WorkingGroups;


const wg = {
  "id": 24812,
  "date": "2024-11-08T14:51:26",
  "date_gmt": "2024-11-08T19:51:26",
  "guid": {
    "rendered": "https://content.sorghumbase.org/wordpress/?post_type=working_group&#038;p=24812"
  },
  "modified": "2024-11-08T14:51:26",
  "modified_gmt": "2024-11-08T19:51:26",
  "slug": "genomes",
  "status": "publish",
  "type": "working_group",
  "link": "https://content.sorghumbase.org/wordpress/index.php/working-group/genomes/",
  "title": {
    "rendered": "Genomes"
  },
  "content": {
    "rendered": "<p>This is the WYSIWYG content for the working group. This is just a placeholder. You can add some products of the WG here, like a table of genomes that were selected for sequencing and assembly</p>\n",
    "protected": false
  },
  "template": "",
  "mission": "This is a placeholder for the mission / target of the working group",
  "members": [
    23632,
    23631,
    24136
  ],
  "contact": [
    23632
  ],
  "news": [
    {
      "ID": 19318,
      "post_title": "A New Reference Genome for Sweet Sorghum",
      "post_content": "Sweet sorghum was originally cultivated in the U.S. for the production of food-grade syrup or alcohol, and it still has commercial value as a source of these commodities, as well as an important bioenergy crop.  Understanding the genetic mechanisms underlying sugar production and storage in sorghum is of great interest to both biologists and breeders, and the genes in this pathway represent potential targets for crop improvement.\r\n\r\n&nbsp;\r\n\r\nTo enable investigation of genomic differences between sweet and grain-type sorghums, researchers at the University of North Carolina at Charlotte and Clemson University in South Carolina, with support from the Community Sequencing Program (CSP) at the DOE’s Joint Genome Institute (JGI), have generated a high-quality reference genome for sweet sorghum based on the archetypal ‘Rio’ genotype (<a href=\"http://www.doi.org/10.1186/s12864-019-5734-x\">Cooper et al. 2019</a>).  By comparing this new genome with the original sorghum reference, which comes from the short-stature, early maturing ‘BTx623’ genotype used for the production of grain sorghum hybrids, the authors identified 54 genes that were present only in Rio, along with 276 genes present only in BTx623.  Of the genes that were deleted in Rio, three are known sucrose pathway genes from the SWEET transporter family, suggesting that changes in sugar transport, rather than sugar synthesis, may be key to the sweet phenotype in sorghum.  Consistent with that idea, complementary transcriptomics analysis also uncovered differential expression and post-transcriptional regulation of many genes involved in sugar transport.\r\n\r\n&nbsp;\r\n\r\nIn addition to finding differences directly related to sugar accumulation, comparison of the Rio and BTx623 reference genomes revealed more than 2 million mutations, more than 100,000 of which are in the coding regions of genes.  The discovery of these mutations, along with the identification of more than 300 gene presence/absence variants, confirms that the Rio genome will provide a useful resource for future agronomic and physiological studies, allowing sorghum researchers to better identify changes in genomic architecture that may be linked to important phenotypes.\r\n\r\n&nbsp;\r\n\r\nThe latest version of the Rio genome and its annotation can be found on Phytozome (<a href=\"https://phytozome.jgi.doe.gov/pz/portal.html\">https://phytozome.jgi.doe.gov/pz/portal.html</a>).  To download data or browse the genome, go to the ‘Species’ tab on the Phytozome home page and select ‘Sorghum bicolor Rio v2.1’.  Or, to directly link to the genome, use: <a href=\"https://phytozome-next.jgi.doe.gov/info/SbicolorRio_v2_1\">https://phytozome-next.jgi.doe.gov/info/SbicolorRio_v2_1</a>.\r\n\r\n&nbsp;\r\n\r\nRaw data and data from the transcriptomics study are available for download from the NCBI SRA database under BioProject PRJNA331825.",
      "post_excerpt": "",
      "post_author": "44",
      "post_date": "2020-04-17 11:42:56",
      "post_date_gmt": "2020-04-17 15:42:56",
      "post_status": "publish",
      "comment_status": "open",
      "ping_status": "open",
      "post_password": "",
      "post_name": "a-new-reference-genome-for-sweet-sorghum",
      "to_ping": "",
      "pinged": "",
      "post_modified": "2022-02-17 11:42:42",
      "post_modified_gmt": "2022-02-17 16:42:42",
      "post_content_filtered": "",
      "post_parent": 0,
      "guid": "https://content.sorghumbase.org/wordpress/?p=19318",
      "menu_order": 0,
      "post_type": "post",
      "post_mime_type": "",
      "comment_count": "0",
      "comments": false,
      "category": [
        {
          "term_id": "2",
          "name": "News",
          "slug": "news",
          "term_group": "0",
          "term_taxonomy_id": "2",
          "taxonomy": "category",
          "description": "",
          "parent": "0",
          "count": "156",
          "object_id": "24719",
          "term_order": "0",
          "pod_item_id": "2"
        },
        {
          "term_id": "3",
          "name": "Research Note",
          "slug": "researchnote",
          "term_group": "0",
          "term_taxonomy_id": "3",
          "taxonomy": "category",
          "description": "",
          "parent": "0",
          "count": "7",
          "object_id": "20078",
          "term_order": "0",
          "pod_item_id": "3"
        }
      ],
      "post_tag": [
        {
          "term_id": "164",
          "name": "reference genome",
          "slug": "reference-genome",
          "term_group": "0",
          "term_taxonomy_id": "164",
          "taxonomy": "post_tag",
          "description": "",
          "parent": "0",
          "count": "5",
          "object_id": "23714",
          "term_order": "0",
          "pod_item_id": "164"
        },
        {
          "term_id": "231",
          "name": "rio",
          "slug": "rio",
          "term_group": "0",
          "term_taxonomy_id": "231",
          "taxonomy": "post_tag",
          "description": "",
          "parent": "0",
          "count": "3",
          "object_id": "19318",
          "term_order": "0",
          "pod_item_id": "231"
        }
      ],
      "post_format": false,
      "id": 19318
    }
  ],
  "events": [
    {
      "start_date": "2024-05-07",
      "end_date": "2024-05-11",
      "event_url": "https://meetings.cshl.edu/meetings.aspx?meet=GENOME&year=24",
      "organizer": "CSHL",
      "featured_image": 22292,
      "location": "Cold Spring Harbor Laboratory",
      "short_name": "",
      "main_event": false,
      "ID": 23324,
      "post_title": "Biology of Genomes meeting",
      "post_content": "<span style=\"font-weight: 400;\">Cold Spring Harbor Laboratory is hosting the 37th annual Biology of Genomes meeting which will focus on DNA sequence variation and its role in molecular evolution, population genetics, complex diseases, comparative genomics, large-scale studies of gene and protein expression, and genomic approaches to ecological systems. </span>",
      "post_excerpt": "",
      "post_author": "55",
      "post_date": "2024-02-28 14:48:25",
      "post_date_gmt": "2024-02-28 19:48:25",
      "post_status": "publish",
      "comment_status": "closed",
      "ping_status": "closed",
      "post_password": "",
      "post_name": "biology-of-genomes-meeting",
      "to_ping": "",
      "pinged": "",
      "post_modified": "2024-02-28 14:49:17",
      "post_modified_gmt": "2024-02-28 19:49:17",
      "post_content_filtered": "",
      "post_parent": 0,
      "guid": "https://content.sorghumbase.org/wordpress/?post_type=event&#038;p=23324",
      "menu_order": 0,
      "post_type": "event",
      "post_mime_type": "",
      "comment_count": "0",
      "comments": false,
      "id": 23324
    }
  ],
  "logo": {
    "ID": "23116",
    "post_author": "55",
    "post_date": "2024-01-08 11:47:55",
    "post_date_gmt": "2024-01-08 16:47:55",
    "post_content": "",
    "post_title": "CSI logo",
    "post_excerpt": "",
    "post_status": "inherit",
    "comment_status": "open",
    "ping_status": "closed",
    "post_password": "",
    "post_name": "csi-logo",
    "to_ping": "",
    "pinged": "",
    "post_modified": "2024-11-08 14:51:27",
    "post_modified_gmt": "2024-11-08 19:51:27",
    "post_content_filtered": "",
    "post_parent": "23117",
    "guid": "https://content.sorghumbase.org/wordpress/wp-content/uploads/2024/01/CSI-logo.png",
    "menu_order": "0",
    "post_type": "attachment",
    "post_mime_type": "image/png",
    "comment_count": "0",
    "pod_item_id": "23116"
  },
  "images": [
    {
      "ID": "24692",
      "post_author": "55",
      "post_date": "2024-10-17 17:55:35",
      "post_date_gmt": "2024-10-17 21:55:35",
      "post_content": "",
      "post_title": "Guo, Shi paper SB example 2",
      "post_excerpt": "Figure 2: Taxagenomic distribution of SbPRE genes illustrates that the locus toward the end of chromosome 1 is absent in several sorghum varieties.\n",
      "post_status": "inherit",
      "comment_status": "open",
      "ping_status": "closed",
      "post_password": "",
      "post_name": "guo-shi-paper-sb-example-2",
      "to_ping": "",
      "pinged": "",
      "post_modified": "2024-11-08 14:51:27",
      "post_modified_gmt": "2024-11-08 19:51:27",
      "post_content_filtered": "",
      "post_parent": "24693",
      "guid": "https://content.sorghumbase.org/wordpress/wp-content/uploads/2024/10/Guo-Shi-paper-SB-example-2.png",
      "menu_order": "0",
      "post_type": "attachment",
      "post_mime_type": "image/png",
      "comment_count": "0",
      "pod_item_id": "24692"
    }
  ],
  "links": [
    {
      "resource_url": "https://phytozome.jgi.doe.gov/pz/portal.html#!info?alias=Org_Sbicolor",
      "resource_image": {
        "ID": "4336",
        "post_author": "3",
        "post_date": "2018-06-11 14:03:15",
        "post_date_gmt": "2018-06-11 18:03:15",
        "post_content": "",
        "post_title": "JGI-Phytozome",
        "post_excerpt": "",
        "post_status": "inherit",
        "comment_status": "open",
        "ping_status": "closed",
        "post_password": "",
        "post_name": "jgi-phytozome",
        "to_ping": "",
        "pinged": "",
        "post_modified": "2018-06-11 14:03:15",
        "post_modified_gmt": "2018-06-11 18:03:15",
        "post_content_filtered": "",
        "post_parent": "0",
        "guid": "http://content.sorghumbase.org/wordpress/wp-content/uploads/2018/06/JGI-Phytozome.png",
        "menu_order": "0",
        "post_type": "attachment",
        "post_mime_type": "image/png",
        "comment_count": "0",
        "pod_item_id": "4336"
      },
      "resource_category": [],
      "ID": 4329,
      "post_title": "Phytozome",
      "post_content": "<!-- wp:paragraph -->\n<p>Phytozome, the Plant Comparative Genomics portal of the Department of Energy's Joint Genome Institute (JGI), provides JGI users and the broader plant science community a hub for accessing, visualizing and analyzing JGI-sequenced plant genomes, as well as select</p>\n<!-- /wp:paragraph -->",
      "post_excerpt": "",
      "post_author": [],
      "post_date": "2018-06-11 14:00:40",
      "post_date_gmt": "2018-06-11 18:00:40",
      "post_status": "publish",
      "comment_status": "closed",
      "ping_status": "closed",
      "post_password": "",
      "post_name": "phytozome",
      "to_ping": "",
      "pinged": "",
      "post_modified": "2018-07-02 11:08:32",
      "post_modified_gmt": "2018-07-02 15:08:32",
      "post_content_filtered": "",
      "post_parent": [],
      "guid": "http://brie6.cshl.edu/wordpress/?post_type=resource-link&#038;p=4329",
      "menu_order": 0,
      "post_type": "resource-link",
      "post_mime_type": "",
      "comment_count": "0",
      "comments": false,
      "id": 4329
    }
  ],
  "_links": {
    "self": [
      {
        "href": "https://content.sorghumbase.org/wordpress/index.php/wp-json/wp/v2/working_group/24812"
      }
    ],
    "collection": [
      {
        "href": "https://content.sorghumbase.org/wordpress/index.php/wp-json/wp/v2/working_group"
      }
    ],
    "about": [
      {
        "href": "https://content.sorghumbase.org/wordpress/index.php/wp-json/wp/v2/types/working_group"
      }
    ],
    "wp:attachment": [
      {
        "href": "https://content.sorghumbase.org/wordpress/index.php/wp-json/wp/v2/media?parent=24812"
      }
    ],
    "curies": [
      {
        "name": "wp",
        "href": "https://api.w.org/{rel}",
        "templated": true
      }
    ]
  }
}
