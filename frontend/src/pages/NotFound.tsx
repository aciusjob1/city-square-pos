import { Link } from 'react-router-dom';

export function NotFound() {
  return (
    <div className="page">
      <div className="card center">
        <h1>Not found</h1>
        <p className="muted">That page doesn't exist.</p>
        <p><Link to="/">Go to home</Link></p>
      </div>
    </div>
  );
}
