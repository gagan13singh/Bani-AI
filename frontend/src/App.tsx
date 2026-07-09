import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import ModeSelection from './components/ModeSelection';
import BaniCore from './components/BaniCore';
import ErrorBoundary from './components/ErrorBoundary';
import './App.css';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<ModeSelection />} />
        <Route path="/kirtan" element={<ErrorBoundary><BaniCore mode="kirtan" /></ErrorBoundary>} />
        <Route path="/paath" element={<ErrorBoundary><BaniCore mode="paath" /></ErrorBoundary>} />
      </Routes>
    </Router>
  );
}

export default App;
