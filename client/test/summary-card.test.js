import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import SummaryCard from '../src/SummaryCard.js';
const data = { start: '2026-11-15', end: '2026-11-15', count: 2, average: 120, lowest: 100, highest: 140 };
const render = props => renderToStaticMarkup(createElement(SummaryCard, { title: 'Daily snapshot', ...props }));

test('pending summary shows loading only while a request is running', () => {
  assert.match(render({ loading: true }), /Loading summary/);
});
test('SW-004: failed request shows retry guidance instead of an endless loader', () => {
  const html = render({ loading: false, error: 'Network unavailable', data: null });
  assert.match(html, /Unable to load this summary/);
  assert.match(html, /Try loading again/);
  assert.doesNotMatch(html, /Loading summary/);
  assert.doesNotMatch(html, /No readings recorded/);
});
test('error overrides old data and a pending loading flag', () => {
  const html = render({ loading: true, error: 'Request failed', data });
  assert.match(html, /Unable to load this summary/);
  assert.doesNotMatch(html, /Loading summary|120\.0|Average glucose/);
});
test('retry can transition from failure to loading to a successful summary', () => {
  assert.match(render({ error: 'Failed' }), /Unable to load/);
  assert.match(render({ loading: true, error: '' }), /Loading summary/);
  const recovered = render({ loading: false, error: '', data });
  assert.match(recovered, /120\.0/);
  assert.match(recovered, /100/);
  assert.match(recovered, /140/);
  assert.doesNotMatch(recovered, /Loading summary|Unable to load/);
});
test('successful empty response is an empty state rather than a failure', () => {
  const html = render({ data: { ...data, count: 0, average: null, lowest: null, highest: null } });
  assert.match(html, /No readings recorded for this period/);
  assert.doesNotMatch(html, /Unable to load|Loading summary/);
});
test('missing data after loading completes does not leave an indefinite spinner', () => {
  const html = render({ loading: false, data: null });
  assert.match(html, /Unable to load/);
  assert.doesNotMatch(html, /Loading summary/);
});
