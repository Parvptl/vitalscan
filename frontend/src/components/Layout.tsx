import { Link, Outlet, useLocation } from 'react-router-dom';
import { PulseIcon } from './Icons';

export function Layout() {
  const { pathname } = useLocation();
  const onMeasure = pathname === '/measure' || pathname === '/processing';

  return (
    <div className="vs-app">
      <a href="#vs-main" className="vs-visually-hidden">
        Skip to main content
      </a>
      <header className="vs-header">
        <Link to="/" className="vs-brand" aria-label="VitalScan home">
          <span className="vs-brand__mark" aria-hidden="true">
            <PulseIcon size={24} />
          </span>
          VitalScan
        </Link>
        {!onMeasure && (
          <Link to="/instructions" className="vs-header__link">
            How it works
          </Link>
        )}
      </header>
      <main id="vs-main" className="vs-app" style={{ background: 'none' }}>
        <Outlet />
      </main>
    </div>
  );
}
