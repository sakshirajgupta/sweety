import React from 'react';
import { test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
const mocks = vi.hoisted(() => ({ api: vi.fn(), restoreSession: vi.fn(), setToken: vi.fn() }));
vi.mock('../src/api.js', () => mocks);
import App from '../src/App';
const user = { id: 1, name: 'Test Patient', email: 'test@example.com' };
const reading = { id: 1, date: '2026-11-15', slot: 'morning', value: 120 };
let failReports;
const mount = () => render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>);
const reportDate = () => screen.getByLabelText('Selected report date');
const formDate = () => screen.getByLabelText('Date', { exact: true });
async function ready() { await screen.findByRole('heading', { name: /A little check-in/ }); await waitFor(() => expect(screen.queryByText('Loading your readings…')).not.toBeInTheDocument()); }
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-17T12:00:00Z'));
  sessionStorage.clear(); failReports = false;
  mocks.api.mockReset(); mocks.restoreSession.mockReset(); mocks.setToken.mockReset();
  mocks.restoreSession.mockResolvedValue(user);
  mocks.api.mockImplementation(async path => {
    const date = new URL(`http://test${path}`).searchParams.get('date');
    const rows = date === reading.date ? [reading] : [];
    if (path.startsWith('/reports')) {
      if (failReports) throw new Error('Simulated report failure');
      const summary = { start: date, end: date, count: rows.length, average: rows.length ? 120 : null, highest: rows.length ? 120 : null, lowest: rows.length ? 120 : null };
      return { daily: { ...summary, readings: rows }, monthToDate: summary, monthly: summary };
    }
    if (path.startsWith('/readings?')) return { readings: rows };
    throw new Error('Unexpected mutation in read-only UI test');
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

test('report date and add-form date synchronize in both directions', async () => {
  mount(); await ready();
  fireEvent.change(reportDate(), { target: { value: '2026-11-15' } });
  expect(formDate()).toHaveValue('2026-11-15');
  await screen.findByRole('heading', { name: 'Readings for 15 Nov 2026' });
  fireEvent.change(formDate(), { target: { value: '2026-11-14' } });
  expect(reportDate()).toHaveValue('2026-11-14');
  await waitFor(() => expect(mocks.api).toHaveBeenCalledWith('/reports?date=2026-11-14', expect.anything()));
});

test('Today aligns both date contexts', async () => {
  mount(); await ready();
  fireEvent.change(reportDate(), { target: { value: '2026-11-15' } });
  await userEvent.click(screen.getByRole('button', { name: 'Today', exact: true }));
  expect(reportDate()).toHaveValue('2026-11-17'); expect(formDate()).toHaveValue('2026-11-17');
});

test('a remounted page verifies the session and restores the selected date', async () => {
  mount(); await ready();
  fireEvent.change(reportDate(), { target: { value: '2026-11-15' } });
  await waitFor(() => expect(sessionStorage.getItem('sweety.selectedDate.1')).toBe('2026-11-15'));
  cleanup(); mount(); await ready();
  expect(mocks.restoreSession).toHaveBeenCalledTimes(2);
  expect(reportDate()).toHaveValue('2026-11-15'); expect(formDate()).toHaveValue('2026-11-15');
});

test('edit locks report navigation and Cancel discards an unsaved date move', async () => {
  mount(); await ready();
  fireEvent.change(reportDate(), { target: { value: '2026-11-15' } });
  await userEvent.click(await screen.findByRole('button', { name: 'Edit Morning (fasting) reading' }));
  expect(reportDate()).toBeDisabled(); expect(screen.getByRole('button', { name: 'Today', exact: true })).toBeDisabled();
  fireEvent.change(formDate(), { target: { value: '2026-11-14' } });
  expect(reportDate()).toHaveValue('2026-11-15');
  await userEvent.click(screen.getByRole('button', { name: 'Cancel editing' }));
  expect(reportDate()).toBeEnabled(); expect(formDate()).toHaveValue('2026-11-15');
  expect(mocks.api.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(false);
});

test('delete confirmation can be cancelled without sending DELETE', async () => {
  mount(); await ready(); fireEvent.change(reportDate(), { target: { value: '2026-11-15' } });
  await userEvent.click(await screen.findByRole('button', { name: 'Delete Morning (fasting) reading' }));
  expect(screen.getByRole('dialog')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Keep reading' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(mocks.api.mock.calls.some(([, options]) => options?.method === 'DELETE')).toBe(false);
});

test('failed reports show errors instead of indefinite loading and retry recovers', async () => {
  failReports = true; mount();
  await screen.findByRole('alert');
  expect(screen.getAllByText(/Unable to load this summary/)).toHaveLength(3);
  expect(screen.queryByText('Loading summary…')).not.toBeInTheDocument();
  failReports = false;
  await userEvent.click(screen.getByRole('button', { name: 'Try loading again' }));
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  await waitFor(() => expect(screen.getAllByText('No readings recorded for this period.')).toHaveLength(3));
});

test('tab return revalidates while preserving selected day and unsaved input', async () => {
  mount(); await ready(); fireEvent.change(reportDate(), { target: { value: '2026-11-15' } });
  await screen.findByRole('button', { name: 'Edit Morning (fasting) reading' });
  const value = screen.getByLabelText(/Glucose value/);
  await userEvent.type(value, '170');
  await userEvent.selectOptions(screen.getByLabelText('Time slot'), 'after_lunch');
  const before = mocks.api.mock.calls.length;
  fireEvent.focus(window);
  await waitFor(() => expect(mocks.api.mock.calls.length).toBeGreaterThan(before));
  expect(value).toHaveValue(170);
  expect(screen.getByLabelText('Time slot')).toHaveValue('after_lunch');
  expect(reportDate()).toHaveValue('2026-11-15');
});
