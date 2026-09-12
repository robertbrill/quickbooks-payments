import { Link } from 'react-router-dom'

export default function Landing() {
  return (
    <div className="landing">
      <div className="landing-inner">
        <div className="brand big">
          <span className="logo">B</span>
          <span>Brill Media</span>
        </div>
        <h1>Team portal</h1>
        <p className="muted">
          Internal tools for the Brill Media team. Sign in with your work email to get a one-time link. No password
          needed.
        </p>
        <Link className="button primary" to="/login">
          Sign in
        </Link>
      </div>
    </div>
  )
}
