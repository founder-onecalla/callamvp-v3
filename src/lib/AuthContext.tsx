import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { User, Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

interface AuthContextType {
  user: User | null
  session: Session | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>
  signUp: (email: string, password: string) => Promise<{ error: Error | null }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      // #region agent log - Hypothesis B: Check session loaded from storage
      const tokenParts = session?.access_token?.split('.') || []
      let tokenPayload = null
      try { tokenPayload = JSON.parse(atob(tokenParts[1] || '')) } catch(e) { /* ignore */ }
      fetch('http://127.0.0.1:7242/ingest/1c58ddf9-a044-4791-b751-6563effc4c78',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'AuthContext.tsx:session-load',message:'Session loaded from storage',data:{hasSession:!!session,userId:session?.user?.id,tokenIss:tokenPayload?.iss,tokenAud:tokenPayload?.aud},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
      setSession(session)
      setUser(session?.user ?? null)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      setUser(session?.user ?? null)
    })

    return () => subscription.unsubscribe()
  }, [])

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error }
  }

  const signUp = async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({ email, password })
    return { error }
  }

  const signOut = async () => {
    try {
      await supabase.auth.signOut()
    } catch (error) {
      console.error('Sign out error:', error)
    }
    // Force clear local state even if signOut fails
    setUser(null)
    setSession(null)
    // Clear any cached auth data
    localStorage.removeItem('sb-dkxhtrwwgniontcjpomi-auth-token')
  }

  return (
    <AuthContext.Provider value={{ user, session, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
