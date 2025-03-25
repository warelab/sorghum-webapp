import React from 'react'
import { Provider, connect } from 'redux-bundler-react'

const FundedProjectsListCmp = props => {
  let tallyMe = {
    project_web_sites:0,
    project_publications:0,
    project_news:0,
    project_logo:0,
    project_events:0,
    project_images:0,
    award_amount:0,
    project_title:0
  }
  if (props.sorghumFundedProjects && props.sorghumPeople) {
    const threeYearsAgo = new Date();
    threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);
    props.sorghumFundedProjects.forEach(fundedProject => {
      const endDate = new Date(fundedProject.end_date);
      if (endDate >= threeYearsAgo) {
        Object.keys(tallyMe).forEach((key) => {
          if (fundedProject[key]) {
            if (key === 'award_amount') {
              if (fundedProject[key][0] > 0) {
                tallyMe[key]++
              }
            } else {
              tallyMe[key]++
            }
          }
        })
      }
    });
    console.log(tallyMe);
    return <div>
    </div>
  }
  return <code>loading...</code>
}

const FundedProjectsList = connect(
  'selectSorghumFundedProjects',
  'selectSorghumPeople',
  FundedProjectsListCmp
)

const FundedProjects = (store) => {
  return (
    <Provider store={store}>
      <FundedProjectsList/>
    </Provider>
  )
};

export default FundedProjects;
