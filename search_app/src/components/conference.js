import React from 'react'
import { Provider, connect } from 'redux-bundler-react'

const About = ({conference, imgUrl}) => {
  return <div className="row align-items-center">
    <div className="col-md-6 mb30">
      <img src={imgUrl} alt="" className="img-fluid"/>
    </div>
    <div className="col-md-6 mb30">
      <span className="text-uppercase" style={{'color': '#c74f03'}}>The Adaptable Crop for Diverse Climates, Landscapes and Markets</span>
      <h2 className="mb20">About {conference.title.rendered}</h2>
      <p className="lead" dangerouslySetInnerHTML={{__html: conference.content.rendered}}/>
      <p>The {conference.title.rendered} board members</p>
      <ul className="mb20">
        {conference.board_members.map((bm, idx) => {
          return <li key={idx}>{bm.post_title} <i>{bm.affiliation[0].post_title}</i></li>
        })}
      </ul>
    </div>
  </div>
}

const Sponsors = ({sponsors,media}) => {

  return <div className={"row align-items-center"}>
    <span className="text-uppercase" style={{'color': '#c74f03'}}>SICNA Support</span>
    <h2 className="mb20">2024 Sponsors</h2>
    <p className="lead">A special thanks to our generous sponsors.</p>
    {sponsors.map((sponsor,idx) => {
      return <div className="col-lg-4 col-md-6  mb30">
        <a href={sponsor.resource_url} target="_blank" className="team-card-default">
          <img src={media[sponsor.resource_image].source_url} style={{height:"124px"}} alt="" className="img-fluid centered"/>
        </a>
      </div>
    })}
    </div>
};

const Agenda = props => {
  return <div className="row align-itmes-center">
    <h2 className="mb20">Agenda</h2>
    <i>Coming soon...</i>
  </div>
}

const Abstracts = props => {
  return <div className="row align-itmes-center">
    <h2 className="mb20">Abstracts</h2>
    <i>Coming soon...</i>
  </div>
}
const ConferenceCmp = props => {
  if (!props.sorghumConference) return <code>loading conferences</code>
  if (props.sorghumConference.hasOwnProperty(props.slug)) {
    const conference = props.sorghumConference[props.slug];
    if (conference.featured_media) {
      let media_ids = [conference.featured_media];
      conference.sponsors.forEach(sponsor => {
        media_ids.push(sponsor.resource_image)
      });
      if (!props.sorghumMedia.hasOwnProperty(conference.featured_media)) {
        props.doRequestMedia(media_ids);
      } else {
        const imgUrl = props.sorghumMedia[conference.featured_media].media_details.sizes.full.source_url;
        return <div>
          <About conference={conference} imgUrl={imgUrl}/>
          <Sponsors sponsors={conference.sponsors} media={props.sorghumMedia}/>
          <Agenda/>
          <Abstracts/>
        </div>
      }
    }
    return <code>loading...</code>
  }
  return <code>invalid conference id '{props.slug}'</code>
}

const Conference = connect(
  'selectSorghumConference',
  'selectSorghumMedia',
  'doRequestMedia',
  ConferenceCmp
)

const ConferencePage = (store) => {
  return (
    <Provider store={store}>
      <Conference slug={window.conference_slug}/>
    </Provider>
  )
};

export default ConferencePage;
