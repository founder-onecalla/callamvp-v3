import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { useSettings } from '../hooks/useSettings'
import type { CallerMode, ThemeMode, TextSizeMode } from '../lib/types'

type Section = 'account' | 'calling' | 'privacy' | 'notifications' | 'appearance'

export default function Settings() {
  const { user } = useAuth()
  const { settings, isLoading, isSaving, error, updateSettings, deleteAllCallHistory, exportCallHistory } = useSettings()

  const [activeSection, setActiveSection] = useState<Section>('account')
  const [hasChanges, setHasChanges] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)

  // Form state
  const [displayName, setDisplayName] = useState('')
  const [callerMode, setCallerMode] = useState<CallerMode>('SELF_NAME')
  const [otherCallerName, setOtherCallerName] = useState('')
  const [requireSensitiveConfirmation, setRequireSensitiveConfirmation] = useState(true)
  const [transcriptRetention, setTranscriptRetention] = useState(30)
  const [notifyCompleted, setNotifyCompleted] = useState(false)
  const [notifyFailed, setNotifyFailed] = useState(true)
  const [theme, setTheme] = useState<ThemeMode>('SYSTEM')
  const [textSize, setTextSize] = useState<TextSizeMode>('NORMAL')

  // Delete confirmation
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)

  // Initialize form from settings
  useEffect(() => {
    if (settings) {
      setDisplayName(settings.display_name || '')
      setCallerMode(settings.default_caller_mode)
      setOtherCallerName(settings.default_caller_other_name || '')
      setRequireSensitiveConfirmation(settings.require_sensitive_confirmation)
      setTranscriptRetention(settings.transcript_retention_days)
      setNotifyCompleted(settings.notify_call_completed)
      setNotifyFailed(settings.notify_call_failed)
      setTheme(settings.theme)
      setTextSize(settings.text_size)
    }
  }, [settings])

  // Track changes
  useEffect(() => {
    if (!settings) return
    const changed =
      displayName !== (settings.display_name || '') ||
      callerMode !== settings.default_caller_mode ||
      otherCallerName !== (settings.default_caller_other_name || '') ||
      requireSensitiveConfirmation !== settings.require_sensitive_confirmation ||
      transcriptRetention !== settings.transcript_retention_days ||
      notifyCompleted !== settings.notify_call_completed ||
      notifyFailed !== settings.notify_call_failed ||
      theme !== settings.theme ||
      textSize !== settings.text_size
    setHasChanges(changed)
  }, [settings, displayName, callerMode, otherCallerName, requireSensitiveConfirmation, transcriptRetention, notifyCompleted, notifyFailed, theme, textSize])

  const handleSave = async () => {
    const success = await updateSettings({
      display_name: displayName || null,
      default_caller_mode: callerMode,
      default_caller_other_name: otherCallerName || null,
      require_sensitive_confirmation: requireSensitiveConfirmation,
      transcript_retention_days: transcriptRetention,
      notify_call_completed: notifyCompleted,
      notify_call_failed: notifyFailed,
      theme,
      text_size: textSize,
    })

    if (success) {
      setHasChanges(false)
      setSaveMessage('Settings saved')
      setTimeout(() => setSaveMessage(null), 3000)
    }
  }

  const handleDeleteAllHistory = async () => {
    if (deleteConfirmText !== 'DELETE') return

    setIsDeleting(true)
    const success = await deleteAllCallHistory()
    setIsDeleting(false)

    if (success) {
      setDeleteConfirmText('')
      setSaveMessage('Call history deleted')
      setTimeout(() => setSaveMessage(null), 3000)
    }
  }

  const handleExport = async () => {
    const data = await exportCallHistory()
    if (data) {
      const blob = new Blob([data], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `onecalla-calls-${new Date().toISOString().split('T')[0]}.json`
      a.click()
      URL.revokeObjectURL(url)
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
      </div>
    )
  }

  const sections: { id: Section; label: string; icon: string }[] = [
    { id: 'account', label: 'Account', icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z' },
    { id: 'calling', label: 'Calling', icon: 'M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z' },
    { id: 'privacy', label: 'Privacy', icon: 'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z' },
    { id: 'notifications', label: 'Notifications', icon: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9' },
    { id: 'appearance', label: 'Appearance', icon: 'M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01' },
  ]

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              to="/"
              className="text-gray-500 hover:text-gray-700 p-2 -ml-2 rounded-lg hover:bg-gray-100"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <h1 className="text-lg font-semibold text-gray-900">Settings</h1>
          </div>
          <span className="text-sm text-gray-500">{user?.email}</span>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="flex gap-6">
          {/* Left Nav */}
          <nav className="w-48 flex-shrink-0 hidden md:block">
            <div className="sticky top-24 space-y-1">
              {sections.map((section) => (
                <button
                  key={section.id}
                  onClick={() => setActiveSection(section.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    activeSection === section.id
                      ? 'bg-blue-50 text-blue-600'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={section.icon} />
                  </svg>
                  {section.label}
                </button>
              ))}
            </div>
          </nav>

          {/* Mobile Nav */}
          <div className="md:hidden w-full mb-4 overflow-x-auto">
            <div className="flex gap-2 pb-2">
              {sections.map((section) => (
                <button
                  key={section.id}
                  onClick={() => setActiveSection(section.id)}
                  className={`flex-shrink-0 px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                    activeSection === section.id
                      ? 'bg-blue-500 text-white'
                      : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {section.label}
                </button>
              ))}
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              {/* Account Section */}
              {activeSection === 'account' && (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900 mb-1">Account</h2>
                    <p className="text-sm text-gray-500">Manage your profile and account settings.</p>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Display Name
                      </label>
                      <input
                        type="text"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder="Your name"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                      <p className="mt-1 text-xs text-gray-500">
                        This name is used when the agent says "calling on behalf of..."
                      </p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Email
                      </label>
                      <input
                        type="email"
                        value={user?.email || ''}
                        disabled
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 text-gray-500"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Calling Section */}
              {activeSection === 'calling' && (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900 mb-1">Calling</h2>
                    <p className="text-sm text-gray-500">Configure how the agent identifies you on calls.</p>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Default Caller Identity
                      </label>
                      <div className="space-y-2">
                        <label className="flex items-start gap-3 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50">
                          <input
                            type="radio"
                            name="callerMode"
                            checked={callerMode === 'SELF_NAME'}
                            onChange={() => setCallerMode('SELF_NAME')}
                            className="mt-0.5"
                          />
                          <div>
                            <div className="font-medium text-gray-900">Use my display name</div>
                            <div className="text-sm text-gray-500">
                              "I'm calling on behalf of {displayName || '[your name]'}"
                            </div>
                          </div>
                        </label>

                        <label className="flex items-start gap-3 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50">
                          <input
                            type="radio"
                            name="callerMode"
                            checked={callerMode === 'OTHER_NAME'}
                            onChange={() => setCallerMode('OTHER_NAME')}
                            className="mt-0.5"
                          />
                          <div className="flex-1">
                            <div className="font-medium text-gray-900">Use a different name</div>
                            <div className="text-sm text-gray-500 mb-2">
                              "I'm calling on behalf of [custom name]"
                            </div>
                            {callerMode === 'OTHER_NAME' && (
                              <input
                                type="text"
                                value={otherCallerName}
                                onChange={(e) => setOtherCallerName(e.target.value)}
                                placeholder="Enter name"
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                            )}
                          </div>
                        </label>

                        <label className="flex items-start gap-3 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50">
                          <input
                            type="radio"
                            name="callerMode"
                            checked={callerMode === 'DONT_DISCLOSE'}
                            onChange={() => setCallerMode('DONT_DISCLOSE')}
                            className="mt-0.5"
                          />
                          <div>
                            <div className="font-medium text-gray-900">Don't disclose unless asked</div>
                            <div className="text-sm text-gray-500">
                              The agent won't volunteer your name, but will answer if asked directly.
                            </div>
                          </div>
                        </label>
                      </div>
                    </div>

                    <div className="pt-4 border-t border-gray-200">
                      <label className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={requireSensitiveConfirmation}
                          onChange={(e) => setRequireSensitiveConfirmation(e.target.checked)}
                          className="mt-1"
                        />
                        <div>
                          <div className="font-medium text-gray-900">
                            Require confirmation for sensitive requests
                          </div>
                          <div className="text-sm text-gray-500">
                            When asking about schedules, locations, or personal info, the agent will confirm your identity and relationship first.
                          </div>
                        </div>
                      </label>
                    </div>
                  </div>
                </div>
              )}

              {/* Privacy Section */}
              {activeSection === 'privacy' && (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900 mb-1">Privacy</h2>
                    <p className="text-sm text-gray-500">Manage your data and call history retention.</p>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Call Transcript Retention
                      </label>
                      <select
                        value={transcriptRetention}
                        onChange={(e) => setTranscriptRetention(Number(e.target.value))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value={7}>7 days</option>
                        <option value={30}>30 days</option>
                        <option value={0}>Forever</option>
                      </select>
                      <p className="mt-1 text-xs text-gray-500">
                        After this period, transcript content is removed but call metadata (time, duration, status) is kept.
                      </p>
                    </div>

                    <div className="pt-4 border-t border-gray-200">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Export Call History
                      </label>
                      <button
                        onClick={handleExport}
                        className="px-4 py-2 text-sm font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
                      >
                        Download JSON
                      </button>
                      <p className="mt-1 text-xs text-gray-500">
                        Download all your call history including transcripts.
                      </p>
                    </div>

                    <div className="pt-4 border-t border-gray-200">
                      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                        <h3 className="text-sm font-medium text-red-800 mb-2">Danger Zone</h3>
                        <p className="text-sm text-red-600 mb-3">
                          Permanently delete all your call history. This cannot be undone.
                        </p>
                        <div className="flex items-center gap-3">
                          <input
                            type="text"
                            value={deleteConfirmText}
                            onChange={(e) => setDeleteConfirmText(e.target.value)}
                            placeholder='Type "DELETE" to confirm'
                            className="flex-1 px-3 py-2 border border-red-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                          />
                          <button
                            onClick={handleDeleteAllHistory}
                            disabled={deleteConfirmText !== 'DELETE' || isDeleting}
                            className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                          >
                            {isDeleting ? 'Deleting...' : 'Delete All'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Notifications Section */}
              {activeSection === 'notifications' && (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900 mb-1">Notifications</h2>
                    <p className="text-sm text-gray-500">Choose what notifications you receive.</p>
                  </div>

                  <div className="space-y-4">
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                      <p className="text-sm text-amber-800">
                        Email notifications coming soon. Settings are saved for when this feature launches.
                      </p>
                    </div>

                    <div className="space-y-3">
                      <label className="flex items-center justify-between p-3 border border-gray-200 rounded-lg">
                        <div>
                          <div className="font-medium text-gray-900">Call completed</div>
                          <div className="text-sm text-gray-500">Get notified when a call finishes successfully</div>
                        </div>
                        <input
                          type="checkbox"
                          checked={notifyCompleted}
                          onChange={(e) => setNotifyCompleted(e.target.checked)}
                          className="w-5 h-5 text-blue-500 rounded"
                        />
                      </label>

                      <label className="flex items-center justify-between p-3 border border-gray-200 rounded-lg">
                        <div>
                          <div className="font-medium text-gray-900">Call failed</div>
                          <div className="text-sm text-gray-500">Get notified when a call fails or doesn't connect</div>
                        </div>
                        <input
                          type="checkbox"
                          checked={notifyFailed}
                          onChange={(e) => setNotifyFailed(e.target.checked)}
                          className="w-5 h-5 text-blue-500 rounded"
                        />
                      </label>
                    </div>
                  </div>
                </div>
              )}

              {/* Appearance Section */}
              {activeSection === 'appearance' && (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900 mb-1">Appearance</h2>
                    <p className="text-sm text-gray-500">Customize how OneCalla looks.</p>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Theme
                      </label>
                      <div className="grid grid-cols-3 gap-3">
                        {(['SYSTEM', 'LIGHT', 'DARK'] as ThemeMode[]).map((t) => (
                          <button
                            key={t}
                            onClick={() => setTheme(t)}
                            className={`p-3 border rounded-lg text-center transition-colors ${
                              theme === t
                                ? 'border-blue-500 bg-blue-50 text-blue-700'
                                : 'border-gray-200 hover:bg-gray-50'
                            }`}
                          >
                            <div className="text-sm font-medium">
                              {t === 'SYSTEM' ? 'System' : t === 'LIGHT' ? 'Light' : 'Dark'}
                            </div>
                          </button>
                        ))}
                      </div>
                      <p className="mt-1 text-xs text-gray-500">
                        Dark mode support coming soon.
                      </p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Text Size
                      </label>
                      <div className="grid grid-cols-2 gap-3">
                        <button
                          onClick={() => setTextSize('NORMAL')}
                          className={`p-3 border rounded-lg text-center transition-colors ${
                            textSize === 'NORMAL'
                              ? 'border-blue-500 bg-blue-50 text-blue-700'
                              : 'border-gray-200 hover:bg-gray-50'
                          }`}
                        >
                          <div className="text-sm font-medium">Normal</div>
                        </button>
                        <button
                          onClick={() => setTextSize('LARGE')}
                          className={`p-3 border rounded-lg text-center transition-colors ${
                            textSize === 'LARGE'
                              ? 'border-blue-500 bg-blue-50 text-blue-700'
                              : 'border-gray-200 hover:bg-gray-50'
                          }`}
                        >
                          <div className="text-base font-medium">Large</div>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Sticky Save Bar */}
      {hasChanges && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-3 shadow-lg">
          <div className="max-w-5xl mx-auto flex items-center justify-between">
            <span className="text-sm text-gray-600">You have unsaved changes</span>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  if (settings) {
                    setDisplayName(settings.display_name || '')
                    setCallerMode(settings.default_caller_mode)
                    setOtherCallerName(settings.default_caller_other_name || '')
                    setRequireSensitiveConfirmation(settings.require_sensitive_confirmation)
                    setTranscriptRetention(settings.transcript_retention_days)
                    setNotifyCompleted(settings.notify_call_completed)
                    setNotifyFailed(settings.notify_call_failed)
                    setTheme(settings.theme)
                    setTextSize(settings.text_size)
                  }
                }}
                className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800"
              >
                Discard
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-500 rounded-lg hover:bg-blue-600 disabled:bg-blue-300"
              >
                {isSaving ? 'Saving...' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Save confirmation toast */}
      {saveMessage && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 bg-gray-900 text-white px-4 py-2 rounded-lg shadow-lg text-sm">
          {saveMessage}
        </div>
      )}

      {/* Error toast */}
      {error && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 bg-red-600 text-white px-4 py-2 rounded-lg shadow-lg text-sm">
          {error}
        </div>
      )}
    </div>
  )
}
