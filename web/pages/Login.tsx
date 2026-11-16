import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useAuth } from '../auth.tsx';
import { message } from '../api.ts';
import { ErrorMessage, Loading } from '../components/Feedback.tsx';
import { safeNext } from '../authNavigation.ts';

export function LoginPage() {
  const { user, loading, login, logout } = useAuth();
  const [username, setUsername] = useState(''), [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [params] = useSearchParams(), navigate = useNavigate();
  async function submit() {
    setBusy(true); setError('');
    try { await login(username, password); setPassword(''); navigate(safeNext(params.get('next')), { replace: true }); }
    catch (error) { setError(message(error)); setPassword(''); }
    finally { setBusy(false); }
  }
  async function disconnect() {
    setBusy(true); setError('');
    try { await logout(); } catch (error) { setError(message(error)); } finally { setBusy(false); }
  }
  return <div className="narrow-page login-page"><header className="page-heading"><p className="eyebrow">Le carnet de Fleur & Noé</p><h1>{user ? 'Vous êtes en ' : 'Entrez en '}<em>salle.</em></h1><p className="lead">{user ? 'Votre compte vous permet de garder vos séances et vos souvenirs.' : 'La collection se consulte librement. Connectez-vous pour garder vos séances et vos souvenirs.'}</p></header>
    {loading ? <Loading /> : <section className="surface">{user ? <div className="form-body"><p>Connecté·e en tant que <strong>{user.username}</strong>.</p><button type="button" disabled={busy} onClick={() => void disconnect()}>{busy ? 'Déconnexion…' : 'Se déconnecter'}</button></div>
      : <form onSubmit={event => { event.preventDefault(); void submit(); }}><fieldset className="form-body" disabled={busy}>
        <label htmlFor="username">Identifiant<input id="username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required minLength={2} maxLength={32} value={username} onChange={event => setUsername(event.target.value)} /></label>
        <label htmlFor="password">Mot de passe<input id="password" name="password" type="password" autoComplete="current-password" required maxLength={1024} value={password} onChange={event => setPassword(event.target.value)} /></label>
        <button className="primary" type="submit">{busy ? 'Connexion…' : 'Se connecter'}</button>
      </fieldset></form>}{error && <ErrorMessage>{error}</ErrorMessage>}</section>}
  </div>;
}
