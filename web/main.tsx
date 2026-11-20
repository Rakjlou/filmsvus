import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, NavLink, Route, Routes, useLocation } from 'react-router';
import { ListPage } from './pages/List.tsx';
import { FilmPage } from './pages/Film.tsx';
import { AddPage } from './pages/Add.tsx';
import { ReratePage } from './pages/Rerate.tsx';
import { StatsPage } from './pages/Stats.tsx';
import { Icon } from './components/Icon.tsx';
import { Empty } from './components/Feedback.tsx';
import { AuthProvider, RequireAuth, useAuth } from './auth.tsx';
import { LoginPage } from './pages/Login.tsx';
import './styles.css';

function ThemeToggle() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme ?? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const update = () => { if (!document.documentElement.dataset.theme) setTheme(media.matches ? 'light' : 'dark'); };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  function toggle() {
    const next = theme === 'light' ? 'dark' : 'light';
    setTheme(next); document.documentElement.dataset.theme = next;
    try { localStorage.setItem('filmsvus-theme', next); } catch { /* Browsers may restrict storage. */ }
  }
  return <button type="button" className="icon-button theme-toggle" onClick={toggle} aria-label={theme === 'dark' ? 'Passer au thème clair' : 'Passer au thème sombre'} title={theme === 'dark' ? 'Allumer la salle' : 'Éteindre la salle'}><Icon name={theme === 'dark' ? 'sun' : 'moon'} /></button>;
}
function App() {
  const location = useLocation();
  const { user, canEdit } = useAuth();
  useEffect(() => {
    const title = location.pathname === '/' ? 'La collection' : location.pathname === '/ajouter' ? 'Ajouter une séance' : location.pathname === '/renoter' ? 'Renoter' : location.pathname === '/stats' ? 'Nos statistiques' : location.pathname === '/connexion' ? 'Connexion' : 'La fiche';
    document.title = `${title} · Films vus`;
    document.getElementById('main')?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [location.pathname]);
  return <><a className="skip-link" href="#main">Aller au contenu</a><header className="site-header"><div className="header-inner"><Link className="brand" to="/" aria-label="Films vus, accueil"><span className="brand-mark"><Icon name="film" /></span><span>films <i>vus.</i></span></Link><span className="brand-subtitle">LE CARNET DE FLEUR & NOÉ</span><nav className={`main-nav${canEdit ? ' main-nav-editable' : ''}`} aria-label="Navigation principale"><NavLink to="/" end><Icon name="film" /><span>Liste</span></NavLink>{canEdit && <NavLink to="/ajouter"><Icon name="plus" /><span>Ajouter</span></NavLink>}{canEdit && <NavLink to="/renoter"><Icon name="rerate" /><span>Renoter</span></NavLink>}<NavLink to="/stats"><Icon name="stats" /><span>Stats</span></NavLink>{!user && <NavLink to="/connexion"><Icon name="account" /><span>Connexion</span></NavLink>}</nav>{canEdit && <Link className="icon-button button account-control" to="/connexion" title={`Compte : ${user?.username}`} aria-label={`Compte de ${user?.username}`}><Icon name="account" /></Link>}<ThemeToggle /></div></header>
    <main id="main" className="page-shell" tabIndex={-1}><Routes><Route path="/" element={<ListPage />} /><Route path="/film/:id" element={<FilmPage key={location.pathname} />} /><Route path="/ajouter" element={<RequireAuth><AddPage /></RequireAuth>} /><Route path="/renoter" element={<RequireAuth><ReratePage /></RequireAuth>} /><Route path="/connexion" element={<LoginPage />} /><Route path="/stats" element={<StatsPage />} /><Route path="*" element={<Empty title="Cette salle n’existe pas."><Link className="button" to="/">Retour à la collection</Link></Empty>} /></Routes></main>
    <footer className="site-footer"><span className="footer-rule" /><p>Le cinéma se partage. Les avis, pas toujours.</p><span>FLEUR & NOÉ · FILMS VUS</span></footer></>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><BrowserRouter><AuthProvider><App /></AuthProvider></BrowserRouter></StrictMode>);
