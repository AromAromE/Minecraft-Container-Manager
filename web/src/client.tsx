import { createRoot } from 'react-dom/client';
import { StrictMode } from 'react';
import { RouterProvider } from '@tanstack/react-router';
import { createRouter } from './router';
import { rememberBrowserBuild } from './lib/panel-build';

rememberBrowserBuild();
const router = createRouter();

const container = document.getElementById('root');
if (!container) throw new Error('Root container #root not found');

createRoot(container).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
