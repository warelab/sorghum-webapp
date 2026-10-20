// SorghumBase's guided tour of the gene search: the shared engine from
// gramene-search-tour driven by this site's steps (./tourSteps). Offered from
// the contents list in the Help / Demo view, or by loading /genes?tour=1.

import React from 'react'
import { GeneSearchTour } from 'gramene-search-tour'
import 'gramene-search-tour/dist/tour.css'
import buildSteps from './tourSteps'

const SorghumBaseTour = () => <GeneSearchTour buildSteps={buildSteps} primaryColor="#a03e34" />

export default SorghumBaseTour
