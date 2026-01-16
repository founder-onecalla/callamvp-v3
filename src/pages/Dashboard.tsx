import { useAuth } from '../lib/AuthContext'
import ChatContainer from '../components/Chat/ChatContainer'
import { CallProvider } from '../hooks/useCall'

export default function Dashboard() {
  const { user, signOut } = useAuth()

  return (
    <CallProvider>
      <div className="h-screen flex flex-col bg-white">
        {/* Header - iMessage style with safe area for Dynamic Island */}
        <header className="flex-shrink-0 bg-[#f8f8f8] border-b border-gray-200 px-4 pb-3 pt-safe backdrop-blur-lg bg-opacity-90">
          <div className="pt-3 max-w-2xl mx-auto flex items-center justify-between">
            <h1 className="text-lg font-semibold text-gray-900">OneCalla</h1>
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-500 hidden sm:block">{user?.email}</span>
              <button
                onClick={signOut}
                className="text-sm text-blue-500 hover:text-blue-600 font-medium min-h-[44px] min-w-[44px] flex items-center justify-center"
              >
                Sign out
              </button>
            </div>
          </div>
        </header>

        {/* Chat Area - Takes remaining space */}
        <main className="flex-1 overflow-hidden">
          <ChatContainer />
        </main>
      </div>
    </CallProvider>
  )
}
