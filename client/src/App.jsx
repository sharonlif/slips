import { useState, useEffect } from 'react';
import { useAuth } from './hooks/useAuth';
import { Login } from './components/Login';
import { Notes } from './components/Notes';
import { Privacy } from './components/Privacy';
import { Terms } from './components/Terms';
import './App.css';

function App() {
  const { user, loading } = useAuth();
  const [calendarMessage, setCalendarMessage] = useState(null);
  const path = window.location.pathname;

  // Handle calendar OAuth callback params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const calendarStatus = params.get('calendar');

    if (calendarStatus) {
      // Clear URL params without reload
      window.history.replaceState({}, '', window.location.pathname);

      if (calendarStatus === 'connected') {
        setCalendarMessage({ type: 'success', text: 'Calendar connected successfully' });
      } else if (calendarStatus === 'error') {
        const errorMessage = params.get('message') || 'Connection failed';
        setCalendarMessage({ type: 'error', text: `Calendar connection failed: ${errorMessage}` });
      }

      // Auto-dismiss after 5 seconds
      setTimeout(() => setCalendarMessage(null), 5000);
    }
  }, []);

  // Legal pages don't require auth
  if (path === '/privacy') {
    return <Privacy />;
  }
  if (path === '/terms') {
    return <Terms />;
  }

  if (loading) {
    return (
      <div className="app-loading">
        <div className="loading-spinner"></div>
      </div>
    );
  }

  return (
    <>
      {calendarMessage && (
        <div className={`toast toast-${calendarMessage.type}`}>
          {calendarMessage.text}
          <button className="toast-close" onClick={() => setCalendarMessage(null)}>
            &times;
          </button>
        </div>
      )}
      {user ? <Notes user={user} /> : <Login />}
    </>
  );
}

export default App;
