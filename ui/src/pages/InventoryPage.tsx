import type { AuthUser } from 'aws-amplify/auth'

interface InventoryPageProps {
  user: AuthUser
  signOut: () => void
}

export function InventoryPage({ user, signOut }: InventoryPageProps) {
  return (
    <main className="app-shell">
      <header className="app-header">
        <h1>Record Ranch</h1>
        <span className="user-id">
          {user?.signInDetails?.loginId ?? 'collector'}
        </span>
        <button onClick={signOut} className="sign-out">
          Sign out
        </button>
      </header>
      <section className="app-content">
        <h2>Inventory</h2>
        {/* TODO: fetch and render inventory items */}
        <p>No records yet.</p>
      </section>
    </main>
  )
}
