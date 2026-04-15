import React, { useState, useEffect, useRef } from 'react';
import { Provider, connect } from 'redux-bundler-react'
import PublicationBrowser from './publicationBrowser'

/* ── Status-bar states ─────────────────────────────────────── */
const STATUS = {
  INITIALIZING:  'initializing',
  CHECKING:      'checking',
  UPDATING:      'updating',
  COMPLETE:      'complete',
  ERROR:         'error',
  HIDDEN:        'hidden',
};

/* ── brand palette (matches sidebar/pager) ────────────────── */
const barStyles = {
  wrapper: {
    margin: '12px 0',
    borderRadius: 10,
    overflow: 'hidden',
    border: '1px solid #EDCF82',
    background: '#FFFCF2',
    fontFamily: 'system-ui, sans-serif',
    fontSize: 13,
    transition: 'opacity .4s ease, max-height .4s ease',
  },
  inner: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 14px',
  },
  track: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    background: '#F3E8C8',
    overflow: 'hidden',
  },
  fill: (pct, color) => ({
    width: `${pct}%`,
    height: '100%',
    borderRadius: 3,
    background: color,
    transition: 'width .5s ease',
  }),
  label: {
    whiteSpace: 'nowrap',
    color: '#555',
  },
  errorLabel: {
    whiteSpace: 'nowrap',
    color: '#9F3D34',
    fontWeight: 600,
  },
};

function StatusBar({ status, totalPapers, progress }) {
  const [visible, setVisible] = useState(true);
  const timerRef = useRef(null);

  useEffect(() => {
    if (status === STATUS.COMPLETE) {
      timerRef.current = setTimeout(() => setVisible(false), 3000);
    } else if (status !== STATUS.HIDDEN) {
      setVisible(true);
    }
    return () => clearTimeout(timerRef.current);
  }, [status]);

  if (!visible || status === STATUS.HIDDEN) return null;

  let pct, color, text;
  switch (status) {
    case STATUS.INITIALIZING:
      pct = 10; color = '#D4AA55'; text = 'Initializing…';
      break;
    case STATUS.CHECKING:
      pct = 20; color = '#FCBC19'; text = 'Checking for new papers…';
      break;
    case STATUS.UPDATING: {
      // progress.loaded / progress.total gives batch progress
      // map from 20% → 100%
      const fetchFraction = (progress.total > 0)
        ? progress.loaded / progress.total
        : 0;
      pct = 20 + fetchFraction * 80;
      color = '#00A14B';
      text = totalPapers
        ? `Updating ${totalPapers} papers… (${progress.loaded} of ${progress.total} loaded)`
        : 'Updating papers…';
      break;
    }
    case STATUS.COMPLETE:
      pct = 100; color = '#00A14B'; text = 'Up to date';
      break;
    case STATUS.ERROR:
      pct = 100; color = '#9F3D34'; text = 'Update failed';
      break;
    default:
      return null;
  }

  return (
    <div style={{
      ...barStyles.wrapper,
      opacity: visible ? 1 : 0,
      maxHeight: visible ? 60 : 0,
    }}>
      <div style={barStyles.inner}>
        <span style={status === STATUS.ERROR ? barStyles.errorLabel : barStyles.label}>
          {text}
        </span>
        <div style={barStyles.track}>
          <div style={barStyles.fill(pct, color)} />
        </div>
      </div>
    </div>
  );
}

/* ── Derive a single status from the Redux selector values ── */
function deriveStatus({
  pubs, tags,
  tallyLoading, tagstallyLoading,
  pubsLoading, tagsLoading,
  pubsError, tagsError, tallyError, tagsTallyError,
  tally,
}) {
  // Any error → error
  if (pubsError || tagsError || tallyError || tagsTallyError) {
    return { status: STATUS.ERROR };
  }
  // No data at all yet → initializing
  if (!pubs && !tags) {
    return { status: STATUS.INITIALIZING };
  }
  // Tally fetch in progress → checking
  if (tallyLoading || tagstallyLoading) {
    return { status: STATUS.CHECKING };
  }
  // Publications or tags actively refetching → updating
  if (pubsLoading || tagsLoading) {
    return { status: STATUS.UPDATING, totalPapers: tally || null };
  }
  // Everything loaded
  return { status: STATUS.COMPLETE };
}

/* ── Connected wrapper ────────────────────────────────────── */
const PublicationsListCmp = (props) => {
  const {
    sorghumPublications: pubs,
    sorghumTags: tags,
    sorghumPublicationsTallyIsLoading: tallyLoading,
    sorghumTagsTallyIsLoading: tagstallyLoading,
    sorghumPublicationsIsLoading: pubsLoading,
    sorghumTagsIsLoading: tagsLoading,
    sorghumPublicationsLastError: pubsError,
    sorghumTagsLastError: tagsError,
    sorghumPublicationsTallyLastError: tallyError,
    sorghumTagsTallyLastError: tagsTallyError,
    sorghumPublicationsTally: tally,
    pubProgress,
  } = props;

  const { status, totalPapers } = deriveStatus({
    pubs, tags,
    tallyLoading, tagstallyLoading,
    pubsLoading, tagsLoading,
    pubsError, tagsError, tallyError, tagsTallyError,
    tally,
  });

  // Track whether we have *ever* reached COMPLETE so we can hide the bar
  // after the initial load cycle, but not re-show it on future navigations.
  const [everCompleted, setEverCompleted] = useState(false);
  useEffect(() => {
    if (status === STATUS.COMPLETE) setEverCompleted(true);
  }, [status]);

  const showBar = !everCompleted || status !== STATUS.COMPLETE;

  return (
    <>
      {(showBar || status === STATUS.ERROR) && (
        <div style={{ maxWidth: 900, margin: '0 auto', padding: '0 12px' }}>
          <StatusBar
            status={status}
            totalPapers={totalPapers}
            progress={pubProgress}
          />
        </div>
      )}
      {pubs && tags ? (
        <PublicationBrowser
          publications={pubs}
          tagLabels={tags}
          pageSize={25}
        />
      ) : (
        status !== STATUS.ERROR && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#888' }}>
            Loading publications…
          </div>
        )
      )}
    </>
  );
};

const PublicationsList = connect(
  'selectSorghumPublications',
  'selectSorghumTags',
  'selectSorghumPublicationsTally',
  'selectSorghumPublicationsTallyIsLoading',
  'selectSorghumTagsTallyIsLoading',
  'selectSorghumPublicationsIsLoading',
  'selectSorghumTagsIsLoading',
  'selectSorghumPublicationsLastError',
  'selectSorghumTagsLastError',
  'selectSorghumPublicationsTallyLastError',
  'selectSorghumTagsTallyLastError',
  'selectPubProgress',
  PublicationsListCmp
);

const Publications = (store) => {
  return (
    <Provider store={store}>
      <PublicationsList />
    </Provider>
  );
};

export default Publications;
