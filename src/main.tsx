import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { ProveedorSesion } from './cliente/sesion'
import App from './App'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ProveedorSesion>
      <HashRouter>
        <App />
      </HashRouter>
    </ProveedorSesion>
  </StrictMode>,
)
