import { useAuth } from '../lib/AuthContext'
import ChatContainer from '../components/Chat/ChatContainer'
import { CallProvider } from '../hooks/useCall'

export default function Dashboard() {
  const { user, signOut } = useAuth()

  return (
    <CallProvider>
      <div className="min-h-screen flex flex-col bg-gray-950">
        {/* Header */}
        <header className="bg-gray-900 border-b border-gray-800 px-6 py-3">
          <div className="max-w-3xl mx-auto flex items-center justify-between">
            <h1 className="text-lg font-semibold">OneCalla</h1>
            <div className="flex items-center gap-4">
              <span className="text-gray-400 text-sm hidden sm:block">{user?.email}</span>
              <button
                onClick={signOut}
                className="text-sm text-gray-400 hover:text-white transition"
              >
                Sign out
              </button>
            </div>
          </div>
        </header>

        {/* Chat - Full Width */}
        <main className="flex-1 flex flex-col overflow-hidden">
          <ChatContainer />
        </main>
      </div>
    </CallProvider>
  )
}
