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
