import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/index.css'
import App from './App.tsx'
import { installErrorLogging, reportError } from './lib/errorLogging'

installErrorLogging()

const logReactError = (source: string, error: unknown) => {
  reportError(source, error)
  console.error(error)
}

createRoot(document.getElementById('root')!, {
  onCaughtError: (error) => logReactError('react.caught', error),
  onUncaughtError: (error) => logReactError('react.uncaught', error),
  onRecoverableError: (error) => logReactError('react.recoverable', error),
}).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
