import { useAuth } from '../lib/AuthContext'
import ChatContainer from '../components/Chat/ChatContainer'
import CallArea from '../components/Call/CallArea'
import CallPanel from '../components/Call/CallPanel'
import { CallProvider } from '../hooks/useCall'

export default function Dashboard() {
  const { user, signOut } = useAuth()

  return (
    <CallProvider>
      <div className="min-h-screen flex flex-col">
        {/* Header */}
        <header className="bg-gray-900 border-b border-gray-800 px-6 py-4">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold">Callam</h1>
            <div className="flex items-center gap-4">
              <span className="text-gray-400 text-sm">{user?.email}</span>
              <button
                onClick={signOut}
                className="text-sm text-gray-400 hover:text-white transition"
              >
                Sign out
              </button>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 flex">
          {/* Left side - Chat */}
          <div className="w-1/2 border-r border-gray-800 flex flex-col">
            <ChatContainer />
          </div>

          {/* Right side - Call Area + Panel */}
          <div className="w-1/2 flex flex-col">
            {/* Call Status & Transcript */}
            <div className="flex-1 overflow-hidden">
              <CallArea />
            </div>

            {/* Call Controls */}
            <div className="border-t border-gray-800">
              <CallPanel />
            </div>
          </div>
        </main>
      </div>
    </CallProvider>
  )
}
