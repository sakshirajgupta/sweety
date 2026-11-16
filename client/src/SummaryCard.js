import { createElement as h } from 'react';

function displayDate(date) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}

// Loading, error and empty results are different states.
// Missing data alone must never imply that a request is still running.
export default function SummaryCard({ title, data, featured, loading = false, error = '' }) {
  let content;
  if (error || (!loading && !data)) {
    content = h('p', { className: 'muted' }, 'Unable to load this summary. Use “Try loading again” to retry.');
  } else if (loading) {
    content = h('p', { className: 'muted', role: 'status' }, 'Loading summary…');
  } else if (!data.count) {
    content = h('p', { className: 'empty-summary' }, 'No readings recorded for this period.');
  } else {
    content = [
      h('div', { className: 'average', key: 'average' }, Number(data.average).toFixed(1), ' ', h('span', null, 'mg/dl')),
      h('p', { className: 'average-label', key: 'label' }, 'Average glucose'),
      h('div', { className: 'extremes', key: 'extremes' },
        h('span', null, 'Lowest ', h('strong', null, data.lowest)),
        h('span', null, 'Highest ', h('strong', null, data.highest)),
      ),
    ];
  }
  const ready = !loading && !error && data;
  return h('article', { className: `summary-card ${featured ? 'featured' : ''}` },
    h('div', { className: 'card-top' },
      h('h3', null, title),
      h('span', { className: 'count' }, ready ? data.count : '—', ' readings'),
    ),
    ready ? h('p', { className: 'range' }, displayDate(data.start), data.start !== data.end ? ` – ${displayDate(data.end)}` : '') : null,
    content,
  );
}
