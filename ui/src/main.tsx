import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Amplify } from 'aws-amplify'
import './index.css'
import App from './App.tsx'

const userPoolId = import.meta.env.VITE_COGNITO_USER_POOL_ID
const userPoolClientId = import.meta.env.VITE_COGNITO_CLIENT_ID

if (typeof userPoolId !== 'string' || !userPoolId) {
  throw new Error(
    'Missing required environment variable VITE_COGNITO_USER_POOL_ID for Amplify Auth configuration.',
  )
}

if (typeof userPoolClientId !== 'string' || !userPoolClientId) {
  throw new Error(
    'Missing required environment variable VITE_COGNITO_CLIENT_ID for Amplify Auth configuration.',
  )
}

Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId,
      userPoolClientId,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
