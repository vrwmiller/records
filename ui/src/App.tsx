import { Authenticator } from '@aws-amplify/ui-react'
import '@aws-amplify/ui-react/styles.css'
import './App.css'

function App() {
  return (
    <Authenticator>
      {({ signOut, user }) => (
        <main className="app-shell">
          <header className="app-header">
            <h1>Record Ranch</h1>
            <button onClick={signOut} className="sign-out">
              Sign out
            </button>
          </header>
          <section className="app-content">
            <p>Welcome, {user?.signInDetails?.loginId ?? 'collector'}.</p>
            <p>Inventory view coming soon.</p>
          </section>
        </main>
      )}
    </Authenticator>
  )
}

export default App
