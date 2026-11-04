import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './base.css'
import Workspace from './Workspace.tsx'
import AlertWindow from './AlertWindow.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {new URLSearchParams(window.location.search).get('view') === 'alerts' ? (
      <AlertWindow />
    ) : (
      <Workspace />
    )}
  </StrictMode>,
)
