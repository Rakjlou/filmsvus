import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, NavLink, Route, Routes, useLocation } from 'react-router';
import { ListPage } from './pages/List.tsx';
import { FilmPage } from './pages/Film.tsx';
import { AddPage } from './pages/Add.tsx';
import { StatsPage } from './pages/Stats.tsx';
import { Icon } from './components/Icon.tsx';
import { Empty } from './components/Feedback.tsx';
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
  useEffect(() => {
    const title = location.pathname === '/' ? 'La collection' : location.pathname === '/ajouter' ? 'Ajouter une séance' : location.pathname === '/stats' ? 'Nos statistiques' : 'La fiche';
    document.title = `${title} · Films vus`;
    document.getElementById('main')?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [location.pathname]);
  return <><a className="skip-link" href="#main">Aller au contenu</a><header className="site-header"><div className="header-inner"><Link className="brand" to="/" aria-label="Films vus, accueil"><span className="brand-mark"><Icon name="film" /></span><span>films <i>vus.</i></span></Link><span className="brand-subtitle">LE CARNET DE FLEUR & NOÉ</span><nav className="main-nav" aria-label="Navigation principale"><NavLink to="/" end><Icon name="film" /><span>Liste</span></NavLink><NavLink to="/ajouter"><Icon name="plus" /><span>Ajouter</span></NavLink><NavLink to="/stats"><Icon name="stats" /><span>Stats</span></NavLink></nav><ThemeToggle /></div></header>
    <main id="main" className="page-shell" tabIndex={-1}><Routes><Route path="/" element={<ListPage />} /><Route path="/film/:id" element={<FilmPage key={location.pathname} />} /><Route path="/ajouter" element={<AddPage />} /><Route path="/stats" element={<StatsPage />} /><Route path="*" element={<Empty title="Cette salle n’existe pas."><Link className="button" to="/">Retour à la collection</Link></Empty>} /></Routes></main>
    <footer className="site-footer"><span className="footer-rule" /><p>Le cinéma se partage. Les avis, pas toujours.</p><span>FLEUR & NOÉ · FILMS VUS</span></footer></>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><BrowserRouter><App /></BrowserRouter></StrictMode>);
