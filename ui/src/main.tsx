import { createRoot } from 'react-dom/client';
import './index.css';
import '@xyflow/react/dist/style.css';
import { App } from './App.tsx';
import { boot, newConv, pickProject } from './store.ts';

boot();
// called from the native macOS menu (File → …)
(window as any).agentdesk = { pickProject, newConv };
createRoot(document.getElementById('root')!).render(<App />);
