import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { ProveedorDatos } from './mock/store'
import App from './App'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ProveedorDatos>
      <HashRouter>
        <App />
      </HashRouter>
    </ProveedorDatos>
  </StrictMode>,
)
