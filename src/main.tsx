import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AppStateProvider } from './state/AppState';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><ErrorBoundary><BrowserRouter><AppStateProvider><App /></AppStateProvider></BrowserRouter></ErrorBoundary></React.StrictMode>,
);
