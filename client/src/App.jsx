import { useAuth } from './hooks/useAuth';
import { Login } from './components/Login';
import { Notes } from './components/Notes';
import './App.css';

function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="app-loading">
        <div className="loading-spinner"></div>
      </div>
    );
  }

  return user ? <Notes user={user} /> : <Login />;
}

export default App;
