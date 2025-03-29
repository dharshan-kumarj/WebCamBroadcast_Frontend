import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import Broadcaster from '/home/dharshan/web-projects/web_broadcastFrontend/src/components/Broadcaster.jsx';
import Viewer from '/home/dharshan/web-projects/web_broadcastFrontend/src/components/viewer.jsx';
import './App.css';

function App() {
  return (
    <Router>
      <div className="App">
        <header className="App-header">
          <h1>Webcam Broadcasting App</h1>
          <nav>
            <ul>
              <li>
                <Link to="/">Broadcast</Link>
              </li>
            </ul>
          </nav>
        </header>
        <main>
          <Routes>
            <Route path="/" element={<Broadcaster />} />
            <Route path="/view/:streamId" element={<Viewer />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;