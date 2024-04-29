import React from 'react'
import { Provider, connect } from 'redux-bundler-react'
import Table from 'react-bootstrap/Table'
import './conference.css'

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
          return <li key={idx}>{bm.post_title} <i>{bm.organization[0].post_title}</i></li>
        })}
      </ul>
    </div>
  </div>
}

const Sponsors = ({organizers,sponsors,media}) => {

  return <div className={"row align-items-center"}>
    <span className="text-uppercase" style={{'color': '#c74f03'}}>SICNA Support</span>
    <h2 className="mb20">2024 Sponsors</h2>
    <p className="lead">A special thanks to our generous sponsors. If your are interested in sponsorship for future SICNA events, please contact <a href={`mailto:${organizers[0].email}`}>{organizers[0].post_title}</a></p>
    {sponsors.map((sponsor,idx) => {
      return <div key={idx} className="col-lg-4 col-md-6  mb30">
        <a href={sponsor.resource_url} target="_blank" className="team-card-default">
          <img src={media[sponsor.resource_image].source_url} style={{maxHeight:"200px",maxWidth:"200px"}} alt="" className="img-fluid centered"/>
        </a>
      </div>
    })}
    </div>
};

function groupObjectsByDate(objects) {
  const grouped = {};

  objects.forEach(obj => {
    const date = new Date(obj.start_time);
    const formattedDate = formatDate(date);
    let formattedTime = formatTime(date);
    if (obj.end_time) {
      const date2 = new Date(obj.end_time);
      formattedTime = formatTime(date, date2);
    }
    obj.formattedTime = formattedTime;

    const key = formattedDate;

    if (!grouped[key]) {
      grouped[key] = [];
    }

    grouped[key].push(obj);
  });

  return grouped;
}

function formatDate(date) {
  const daysOfWeek = ['Sun', 'Mon', 'Tues', 'Wed', 'Thurs', 'Fri', 'Sat'];
  const monthsOfYear = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  const dayOfWeek = daysOfWeek[date.getDay()];
  const month = monthsOfYear[date.getMonth()];
  const dayOfMonth = date.getDate();

  return `${dayOfWeek}, ${month} ${dayOfMonth}`;
}
function isValidDate(date) {
  return date instanceof Date && !isNaN(date);
}
function formatTime(startDate, endDate) {
  const startHours = startDate.getHours();
  const startMinutes = startDate.getMinutes();
  const startMeridiem = startHours < 12 ? 'a.m.' : 'p.m.';
  const formattedStartHours = startHours % 12 || 12; // Convert to 12-hour format
  const formattedStartMinutes = startMinutes.toString().padStart(2, '0'); // Add leading zero if minutes < 10

  if (isValidDate(endDate)) {
    const endHours = endDate.getHours();
    const endMinutes = endDate.getMinutes();
    const endMeridiem = endHours < 12 ? 'a.m.' : 'p.m.';
    const formattedEndHours = endHours % 12 || 12; // Convert to 12-hour format
    const formattedEndMinutes = endMinutes.toString().padStart(2, '0'); // Add leading zero if minutes < 10

    if (startMeridiem === endMeridiem) {
      return `${formattedStartHours}:${formattedStartMinutes} - ${formattedEndHours}:${formattedEndMinutes} ${endMeridiem}`;
    } else {
      return `${formattedStartHours}:${formattedStartMinutes} ${startMeridiem} - ${formattedEndHours}:${formattedEndMinutes} ${endMeridiem}`;
    }
  } else {
    return `${formattedStartHours}:${formattedStartMinutes} ${startMeridiem}`
  }
}

function assembleUniqueIds(objects, key) {
  const uniqueIds = new Set();

  objects.forEach(obj => {
    if (obj[key]) {
      obj[key].forEach(id => {
        uniqueIds.add(id);
      });
    }
  });

  // Convert the Set back to an array if needed
  return Array.from(uniqueIds);
}

function formatChairs(people,lut) {
  let formatted = people.map(p => `${lut[p].title.rendered}, ${lut[p].affiliation.join(', ')}`);
  let last = formatted.pop();
  return formatted.length > 0 ?`${formatted.join(', ')} & ${last}` : last;
}
const AgendaCmp = props => {
  if (!(props.sorghumSessions && props.sorghumPeople)) return <code>loading Agenda</code>
  const sessions = props.sorghumSessions.filter(s => props.conference.id === s.conference);
  let people = assembleUniqueIds(sessions, 'organizers');
  const peopleToFetch = people.filter(p => !(props.sorghumPeople.hasOwnProperty(p) && props.sorghumPeople[p].id));
  if (peopleToFetch.length > 0) {
    props.doRequestPeople(peopleToFetch);
    return <code>loading</code>
  }
  const byDay = groupObjectsByDate(sessions);
  return <div className="row align-itmes-center">
    <h2 className="mb20">Agenda</h2>
    {Object.keys(byDay).map((day,idx) => {
      return <Table striped bordered hover key={idx}>
        <thead>
        <tr>
          <th className="date-column">{day}</th>
          <th className="title-column"></th>
          <th className="sponsor-column">Sponsor</th>
          <th className="room-column">Room</th>
        </tr>
        </thead>
        <tbody>
        {byDay[day].map((session,sess_idx) => {
          return <tr key={sess_idx}>
            <td className="date-column">{session.formattedTime}</td>
            <td className="title-column"><b>{session.session_name}</b>
              {session.organizers && <p><i>{session.organizer_label && <span>{session.organizer_label}: </span>}
                {formatChairs(session.organizers, props.sorghumPeople)}</i></p>}
            </td>
            <td className="sponsor-column">{session.sponsors && <a href={session.sponsors[0].resource_url} target="_blank">{session.sponsors[0].post_title}</a>}</td>
            <td className="room-column">{session.room}</td>
          </tr>
        })}
        </tbody>
      </Table>
    })}
  </div>
}

const Agenda = connect(
  'selectSorghumSessions',
  'selectSorghumPeople',
  'doRequestPeople',
  AgendaCmp
)

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
          <Sponsors organizers={conference.organizers} sponsors={conference.sponsors} media={props.sorghumMedia}/>
          <Agenda conference={conference}/>
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
