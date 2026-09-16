import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

// No StrictMode: the ext-apps `useApp` hook connects on first mount and must not run its effects twice.
createRoot(document.getElementById('root')!).render(<App />);
