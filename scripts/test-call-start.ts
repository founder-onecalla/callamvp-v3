/**
 * Test the call-start edge function directly
 * Run with: npx tsx scripts/test-call-start.ts
 */

const SUPABASE_URL = 'https://dkxhtrwwgniontcjpomi.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRreGh0cnd3Z25pb250Y2pwb21pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzY5ODkxMDgsImV4cCI6MjA1MjU2NTEwOH0.aj4x85G3Lxw4Q5_WadS_-tVGYpN2Db-gLRPVKqKA_Ck'

async function testCallStart() {
  console.log('Testing call-start edge function...\n')

  // Create a test payload - we don't actually need a real call_id, 
  // we just want to see what error the function returns
  const testPayload = {
    call_id: 'test-' + Date.now(),
    phone_number: '+17739776657',
  }

  console.log('Request payload:', JSON.stringify(testPayload, null, 2))
  console.log('')

  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/call-start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify(testPayload),
    })

    console.log('Response status:', response.status)
    console.log('Response headers:', Object.fromEntries(response.headers))
    
    const text = await response.text()
    console.log('Response body:', text)

    try {
      const json = JSON.parse(text)
      console.log('Parsed JSON:', JSON.stringify(json, null, 2))
    } catch {
      console.log('(Response is not JSON)')
    }

  } catch (error) {
    console.error('Fetch error:', error)
  }
}

testCallStart()
