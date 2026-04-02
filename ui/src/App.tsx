import { Authenticator } from '@aws-amplify/ui-react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import '@aws-amplify/ui-react/styles.css'
import './App.css'
import { InventoryPage } from './pages/InventoryPage'

function App() {
  return (
    <Authenticator hideSignUp>
      {({ signOut, user }) => (
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Navigate to="/inventory" replace />} />
            <Route
              path="/inventory"
              element={<InventoryPage user={user!} signOut={signOut!} />}
            />
            <Route path="*" element={<Navigate to="/inventory" replace />} />
          </Routes>
        </BrowserRouter>
      )}
    </Authenticator>
  )
}

export default App
