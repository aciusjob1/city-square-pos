import { Link } from 'react-router-dom';
import { useAuth, homePathForRole } from '../auth/AuthContext';
import { DEFAULT_LOGO, useBranding } from '../branding/BrandingContext';
import './AboutPage.css';

const CONTACT = [
  {
    label: 'WhatsApp',
    value: '0772 171 246',
    href: 'https://wa.me/255772171246',
    external: true,
    icon: (
      <path d="M12 3a9 9 0 0 0-7.7 13.6L3 21l4.5-1.2A9 9 0 1 0 12 3Zm0 2a7 7 0 1 1-3.6 13l-.4-.2-2.3.6.6-2.2-.2-.4A7 7 0 0 1 12 5Zm-2.6 3.4c-.2 0-.5.1-.7.4-.3.3-.8.9-.8 1.9s.8 2 .9 2.1c.1.2 1.6 2.5 4 3.4 2 .8 2.4.6 2.9.6.4 0 1.4-.6 1.6-1.1.2-.6.2-1 .1-1.1l-.6-.3-1.5-.7c-.2-.1-.4-.1-.5.1l-.7.9c-.1.1-.3.2-.5.1-.2-.1-1-.4-1.9-1.2-.7-.6-1.1-1.3-1.3-1.5-.1-.2 0-.3.1-.4l.4-.4.2-.4v-.4l-.7-1.6c-.2-.4-.4-.4-.5-.4h-.4Z" />
    ),
  },
  {
    label: 'Phone',
    value: '0613 458 246',
    href: 'tel:+255613458246',
    icon: (
      <path d="M6.6 3h2.2c.5 0 .9.3 1 .8l.8 3c.1.4 0 .8-.4 1l-1.5 1a12 12 0 0 0 5.5 5.5l1-1.5c.2-.3.6-.5 1-.4l3 .8c.5.1.8.5.8 1v2.2c0 .9-.7 1.6-1.6 1.6C10.3 18.1 5.9 13.7 5 5.6 5 4.7 5.7 3 6.6 3Z" />
    ),
  },
  {
    label: 'Email',
    value: 'aciusjob1@gmail.com',
    href: 'mailto:aciusjob1@gmail.com',
    icon: (
      <path d="M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm1.4 2L12 12.2 19.6 7H4.4ZM20 9.1l-7.4 5a1 1 0 0 1-1.2 0L4 9.1V17h16V9.1Z" />
    ),
  },
  {
    label: 'Instagram',
    value: '@Abson_acjo',
    href: 'https://instagram.com/Abson_acjo',
    external: true,
    icon: (
      <path d="M8 3h8a5 5 0 0 1 5 5v8a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5V8a5 5 0 0 1 5-5Zm0 2a3 3 0 0 0-3 3v8a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3V8a3 3 0 0 0-3-3H8Zm4 3.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9Zm0 2a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5ZM17.5 6a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z" />
    ),
  },
];

export function AboutPage() {
  const { user } = useAuth();
  const { branding } = useBranding();
  const backTo = user ? homePathForRole(user.role) : '/login';

  return (
    <main className="page about-page">
      <section className="about-card">
        <header className="about-header">
          <img
            src={branding.restaurantLogo ?? DEFAULT_LOGO}
            alt={`${branding.restaurantName} logo`}
            className="about-logo about-logo-img"
          />
          <div>
            <h1>About {branding.restaurantName} POS</h1>
            <p>Restaurant point-of-sale system · Version 1.0</p>
          </div>
        </header>

        <section className="about-owner" aria-labelledby="about-owner-name">
          <span className="about-eyebrow">Designed &amp; developed by</span>
          <h2 id="about-owner-name">Acius Job Missingo</h2>
          <p>For support, upgrades or custom features, reach out on any of the contacts below.</p>
        </section>

        <ul className="about-contact">
          {CONTACT.map((c) => (
            <li key={c.label}>
              <a
                className="about-contact-row"
                href={c.href}
                target={c.external ? '_blank' : undefined}
                rel={c.external ? 'noreferrer' : undefined}
              >
                <span className="about-contact-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="currentColor">{c.icon}</svg>
                </span>
                <span className="about-contact-text">
                  <span className="about-contact-label">{c.label}</span>
                  <span className="about-contact-value">{c.value}</span>
                </span>
                <span className="about-contact-arrow" aria-hidden="true">›</span>
              </a>
            </li>
          ))}
        </ul>

        <footer className="about-footer">
          <span>© {new Date().getFullYear()} City Square POS</span>
          <Link to={backTo} className="about-back">Back to app</Link>
        </footer>
      </section>
    </main>
  );
}
