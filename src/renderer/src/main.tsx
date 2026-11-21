import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { AppProvider } from './state'
import './styles.css'
import './styles/wiki.css'
import './styles/files.css'
import './styles/chat.css'
import './styles/shell.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </StrictMode>
)
