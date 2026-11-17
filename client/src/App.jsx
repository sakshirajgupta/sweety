import React, { useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { api, setToken, restoreSession } from './api';
import './styles.css';
import SummaryCard from './SummaryCard';
import { subscribeToTabReturn } from './tab-refresh';
import { readingChanges } from './reading-changes';
import { loadSelectedDate, saveSelectedDate } from './selected-date';

const slots = { morning: 'Morning (fasting)', after_breakfast: 'After breakfast', after_lunch: 'After lunch', after_dinner: 'After dinner' };
function today() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = name => parts.find(part => part.type === name).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
function displayDate(date) { return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }); }
function Brand() { return <Link className="brand" to="/"><span className="brand-icon" aria-hidden="true">s</span>Sweety<span className="brand-dot">.</span></Link>; }
function Notice({ children, error = false }) { return children ? <div className={`notice ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'}>{children}</div> : null; }

function Auth({ register, onLogin }) {
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault(); setError(''); setBusy(true);
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      if (register) await api('/auth/register', { method: 'POST', body: data });
      const session = await api('/auth/login', { method: 'POST', body: { email: data.email, password: data.password } });
      setToken(session.token); onLogin(session.user); navigate('/');
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <main className="auth-layout">
    <section className="auth-story"><Brand /><div><span className="eyebrow">A LITTLE CARE, EVERY DAY</span><h1>Your numbers.<br />Your story.<br /><em>One day at a time.</em></h1><p>A calm place to record your blood glucose and keep track of your days.</p><div className="story-note"><span aria-hidden="true">♡</span> Small habits. A clearer picture.</div></div><small>Your personal glucose diary</small></section>
    <section className="auth-form"><div className="auth-card"><span className="eyebrow">WELCOME TO SWEETY</span><h2>{register ? 'Start your diary' : 'Welcome back'}</h2><p className="muted">{register ? 'Create an account to keep your readings together.' : 'A moment to check in with yourself.'}</p><Notice error>{error}</Notice><form onSubmit={submit}>
      {register && <label>Your name<input name="name" autoComplete="name" required maxLength={100} placeholder="e.g. Sakshi" /></label>}
      <label>Email address<input name="email" type="email" autoComplete="email" required maxLength={255} placeholder="you@example.com" /></label>
      <label>Password<input name="password" type="password" autoComplete={register ? 'new-password' : 'current-password'} required minLength={register ? 8 : undefined} placeholder={register ? 'At least 8 characters' : 'Enter your password'} /></label>
      <button className="primary full" disabled={busy}>{busy ? 'Please wait…' : register ? 'Create account' : 'Log in'} <span aria-hidden="true">→</span></button>
    </form><p className="auth-switch">{register ? 'Already have an account?' : 'New to Sweety?'} <Link to={register ? '/login' : '/register'}>{register ? 'Log in' : 'Create an account'}</Link></p><p className="fine-print">Sweety records your readings. It does not provide medical advice.</p></div></section>
  </main>;
}

function Dashboard({ user, onLogout }) {
  const [selected, setSelected] = useState(() => loadSelectedDate(user.id, today()));
  const [reports, setReports] = useState(null);
  const [readings, setReadings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [revision, setRevision] = useState(0);
  const [form, setForm] = useState({ date: selected, slot: 'morning', value: '' });
  const [editing, setEditing] = useState(null);
  const [originalReading, setOriginalReading] = useState(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const [deleting, setDeleting] = useState(null);
  const [deleteError, setDeleteError] = useState('');
  useEffect(() => { saveSelectedDate(user.id, selected); }, [user.id, selected]);
  useEffect(() => {
    if (busy) return;
    return subscribeToTabReturn(() => setRevision(value => value + 1));
  }, [busy]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setLoadError(''); setReports(null); setReadings([]);
    Promise.all([api(`/reports?date=${selected}`, { signal: controller.signal }), api(`/readings?date=${selected}`, { signal: controller.signal })])
      .then(([summary, list]) => { setReports(summary); setReadings(list.readings); })
      .catch(error => { if (error.name !== 'AbortError') setLoadError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [selected, revision]);
  // Adding uses one shared day for the form, list and reports.
  function selectDay(date) {
    if (editing || !date || date > today()) return;
    setSelected(date);
    setForm(previous => ({ ...previous, date }));
    setNotice('');
    setFormError('');
  }
  function changeFormDate(date) {
    setForm(previous => ({ ...previous, date }));
    setFormError('');
    // During editing, changing the form date proposes moving that reading.
    // Keep the original report context until the user saves or cancels.
    if (!editing) selectDay(date);
  }
  function reset() { setEditing(null); setOriginalReading(null); setForm({ date: selected, slot: 'morning', value: '' }); setFormError(''); }
  async function save(event) {
    event.preventDefault(); setFormError(''); setNotice('');
    if (!form.value.trim()) { setFormError('Please enter a glucose value.'); return; }
    const value = Number(form.value);
    if (!Number.isInteger(value) || value < 40 || value > 600) { setFormError('Value must be a whole number between 40 and 600 mg/dl.'); return; }
    if (form.date > today()) { setFormError('Date cannot be in the future.'); return; }
    setBusy(true);
    try {
      const reading = { ...form, value };
      const payload = editing ? readingChanges(originalReading, reading) : reading;
      if (editing && Object.keys(payload).length === 0) {
        setNotice('No changes to save.');
        return;
      }
      const result = await api(editing ? `/readings/${editing}` : '/readings', { method: editing ? 'PATCH' : 'POST', body: payload });
      setNotice(result.message); setSelected(form.date); setEditing(null); setOriginalReading(null); setForm({ date: form.date, slot: 'morning', value: '' }); setRevision(value => value + 1);
    } catch (error) { setFormError(error.message); }
    finally { setBusy(false); }
  }
  function edit(reading) { setEditing(reading.id); setOriginalReading(reading); setForm({ date: reading.date, slot: reading.slot, value: String(reading.value) }); setFormError(''); document.getElementById('reading-form').scrollIntoView({ behavior: 'smooth', block: 'center' }); document.getElementById('glucose-value').focus({ preventScroll: true }); }
  async function remove() {
    setBusy(true); setDeleteError('');
    try { const result = await api(`/readings/${deleting.id}`, { method: 'DELETE' }); if (editing === deleting.id) reset(); setDeleting(null); setNotice(result.message); setRevision(value => value + 1); }
    catch (error) { setDeleteError(error.message); }
    finally { setBusy(false); }
  }
  return <><header className="site-header"><div className="header-inner"><Brand /><span className="header-caption">YOUR PERSONAL GLUCOSE DIARY</span><div className="account"><span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span><span>{user.name}</span><button className="text-button" onClick={onLogout}>Log out</button></div></div></header>
    <main className="dashboard"><section className="page-heading"><div><span className="eyebrow">ONE DAY AT A TIME</span><h1>A little check-in, {user.name.split(' ')[0]}<span className="heading-dot">.</span></h1><p className="muted">Keep your readings together. Get a clearer picture of your days.</p></div><div className="date-controls"><label className="date-select">Your selected day<input aria-label="Selected report date" type="date" value={selected} max={today()} disabled={busy || Boolean(editing)} onChange={e => selectDay(e.target.value)} /></label><button type="button" className="secondary today-button" disabled={busy || Boolean(editing)} onClick={() => selectDay(today())}>Today</button></div></section>
    <Notice>{notice}</Notice><Notice error>{loadError}</Notice>{loadError && <button className="secondary" onClick={() => setRevision(value => value + 1)}>Try loading again</button>}
    <section aria-label="Glucose summaries" className="summary-grid"><SummaryCard title="Daily snapshot" featured data={reports?.daily} loading={loading} error={loadError} /><SummaryCard title="Month to date" data={reports?.monthToDate} loading={loading} error={loadError} /><SummaryCard title="Previous month" data={reports?.monthly} loading={loading} error={loadError} /></section>
    <div className="workspace"><section className="panel form-panel" id="reading-form"><div className="section-heading"><span className="section-icon" aria-hidden="true">＋</span><div><h2>{editing ? 'Edit your reading' : 'Add a reading'}</h2><p className="muted">A small moment for your daily record.</p></div></div>{editing && <p className="muted">Changing the date moves this reading when you save. Save or cancel before browsing another day.</p>}<Notice error>{formError}</Notice><form onSubmit={save}>
      <label>Date<input type="date" required max={today()} value={form.date} disabled={busy} onChange={e => changeFormDate(e.target.value)} /></label>
      <label>Time slot<select value={form.slot} disabled={busy} onChange={e => setForm({ ...form, slot: e.target.value })}>{Object.entries(slots).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label htmlFor="glucose-value">Glucose value <span className="optional">mg/dl</span><input id="glucose-value" type="number" inputMode="numeric" min="40" max="600" step="1" required placeholder="e.g. 120" value={form.value} disabled={busy} onChange={e => setForm({ ...form, value: e.target.value })} /></label>
      <p className="input-help">Enter a whole number from 40 to 600.</p><button className="primary full" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Save reading'} <span aria-hidden="true">→</span></button>{editing && <button type="button" className="text-button full cancel-edit" disabled={busy} onClick={reset}>Cancel editing</button>}
    </form><div className="form-note">One reading per slot, up to four a day. You can add past readings too.</div></section>
    <section className="panel readings-panel"><div className="section-heading readings-heading"><div><span className="eyebrow">YOUR DAILY RECORD</span><h2>Readings for {displayDate(selected)}</h2></div><span className="count">{readings.length} / 4</span></div>
      {loading ? <p className="empty-state" role="status">Loading your readings…</p> : loadError ? <p className="empty-state">Your readings could not be loaded. Please try again.</p> : readings.length === 0 ? <div className="empty-state"><span className="empty-icon" aria-hidden="true">↗</span><h3>A fresh page for your day</h3><p>No readings yet. Add your first one using the form.</p></div> : <div className="reading-list">{readings.map((reading, index) => <article className="reading-row" key={reading.id}><span className="slot-number">{String(Object.keys(slots).indexOf(reading.slot) + 1).padStart(2, '0')}</span><div className="reading-info"><h3>{slots[reading.slot]}</h3><span>{displayDate(reading.date)}</span></div><div className="reading-value">{reading.value}<small>mg/dl</small></div><div className="row-actions"><button className="text-button" disabled={busy} onClick={() => edit(reading)} aria-label={`Edit ${slots[reading.slot]} reading`}>Edit</button><button className="text-button danger" disabled={busy} onClick={() => { setDeleting(reading); setDeleteError(''); }} aria-label={`Delete ${slots[reading.slot]} reading`}>Delete</button></div></article>)}</div>}
      <div className="diary-tip"><span aria-hidden="true">♡</span><p>Your diary helps keep a history to discuss with your doctor. Accepted input values are not a healthy glucose range.</p></div>
    </section></div><footer className="page-footer"><span>Sweety · A little care, every day.</span><span>Dates use India Standard Time · mg/dl</span></footer></main>
    {deleting && <DeleteDialog reading={deleting} busy={busy} error={deleteError} onCancel={() => setDeleting(null)} onDelete={remove} />}
  </>;
}
function DeleteDialog({ reading, busy, error, onCancel, onDelete }) {
  useEffect(() => {
    const dialog = document.getElementById('delete-dialog'); dialog.showModal();
    return () => dialog.close();
  }, []);
  return <dialog id="delete-dialog" onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }} aria-labelledby="delete-title"><h2 id="delete-title">Delete this reading?</h2><p>{slots[reading.slot]} · {reading.value} mg/dl<br />{displayDate(reading.date)}</p><p className="muted">This will permanently remove it from your diary.</p><Notice error>{error}</Notice><div className="dialog-actions"><button className="secondary" disabled={busy} onClick={onCancel}>Keep reading</button><button className="delete-button" disabled={busy} onClick={onDelete}>{busy ? 'Deleting…' : 'Delete reading'}</button></div></dialog>;
}
export default function App() {
  const [user, setUser] = useState(null);
  const [expired, setExpired] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [sessionError, setSessionError] = useState('');
  const [sessionAttempt, setSessionAttempt] = useState(0);
  function logout() { setToken(null); setUser(null); }

  useEffect(() => {
    const controller = new AbortController();
    setCheckingSession(true); setSessionError('');
    restoreSession({ signal: controller.signal })
      .then(restored => { if (!controller.signal.aborted) setUser(restored); })
      .catch(error => { if (!controller.signal.aborted) setSessionError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setCheckingSession(false); });
    return () => controller.abort();
  }, [sessionAttempt]);
  useEffect(() => { const expire = () => { logout(); setExpired(true); }; window.addEventListener('session-expired', expire); return () => window.removeEventListener('session-expired', expire); }, []);
  function login(user) { setUser(user); setExpired(false); }
  if (checkingSession) return <main className="dashboard"><p role="status">Checking your session…</p></main>;
  if (sessionError) return <main className="dashboard"><Brand /><h1>Let's reconnect</h1><Notice error>{sessionError}</Notice><button className="primary" onClick={() => setSessionAttempt(value => value + 1)}>Try again</button></main>;
  return <>{expired && <div className="session-notice" role="alert">Your session expired. Please log in again.</div>}<Routes>
    <Route path="/" element={user ? <Dashboard key={user.id} user={user} onLogout={logout} /> : <Navigate to="/login" replace />} />
    <Route path="/login" element={user ? <Navigate to="/" replace /> : <Auth key="login" onLogin={login} />} />
    <Route path="/register" element={user ? <Navigate to="/" replace /> : <Auth key="register" register onLogin={login} />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes></>;
}

