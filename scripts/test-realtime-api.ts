/**
 * Test script to verify OpenAI Realtime API access
 *
 * Run with: npx ts-node scripts/test-realtime-api.ts
 * Or: deno run --allow-net --allow-env scripts/test-realtime-api.ts
 */

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || Deno?.env?.get?.('OPENAI_API_KEY')

if (!OPENAI_API_KEY) {
  console.error('❌ OPENAI_API_KEY environment variable not set')
  console.log('\nSet it with:')
  console.log('  export OPENAI_API_KEY=sk-...')
  process.exit?.(1) || Deno?.exit?.(1)
}

async function testRealtimeAccess() {
  console.log('🔍 Testing OpenAI Realtime API access...\n')

  try {
    // Method 1: Try to create a Realtime session via REST
    const response = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-realtime-preview',
        voice: 'alloy',
      }),
    })

    if (response.ok) {
      const data = await response.json()
      console.log('✅ SUCCESS! You have Realtime API access.\n')
      console.log('Session details:')
      console.log(`  - Session ID: ${data.id}`)
      console.log(`  - Model: ${data.model}`)
      console.log(`  - Expires: ${data.expires_at}`)
      console.log('\n🎉 Ready to build the audio bridge!')
      return true
    } else {
      const error = await response.text()

      if (response.status === 404) {
        console.log('❌ Realtime API endpoint not found.')
        console.log('   This might mean:')
        console.log('   1. The API endpoint has changed')
        console.log('   2. You need to request beta access')
        console.log('\n   Visit: https://platform.openai.com/docs/guides/realtime')
      } else if (response.status === 401) {
        console.log('❌ Authentication failed.')
        console.log('   Check that your OPENAI_API_KEY is valid.')
      } else if (response.status === 403) {
        console.log('❌ Access denied - you may not have Realtime API access.')
        console.log('   The Realtime API may require:')
        console.log('   1. A specific pricing tier')
        console.log('   2. Beta access approval')
        console.log('\n   Visit: https://platform.openai.com/docs/guides/realtime')
      } else {
        console.log(`❌ Error (${response.status}): ${error}`)
      }
      return false
    }
  } catch (err) {
    console.error('❌ Network error:', err.message)
    return false
  }
}

// Alternative: Test via WebSocket (the actual API method)
async function testWebSocketAccess() {
  console.log('\n🔍 Testing WebSocket connection...\n')

  return new Promise((resolve) => {
    try {
      const url = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview'
      const ws = new WebSocket(url, {
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'OpenAI-Beta': 'realtime=v1',
        },
      })

      const timeout = setTimeout(() => {
        console.log('⏱️ Connection timeout - closing...')
        ws.close()
        resolve(false)
      }, 10000)

      ws.onopen = () => {
        clearTimeout(timeout)
        console.log('✅ WebSocket connected successfully!')
        console.log('🎉 You have full Realtime API access!')
        ws.close()
        resolve(true)
      }

      ws.onerror = (error) => {
        clearTimeout(timeout)
        console.log('❌ WebSocket error:', error.message || 'Connection failed')
        resolve(false)
      }

      ws.onclose = (event) => {
        if (event.code === 1000) {
          // Normal close, already handled
        } else if (event.code === 1006) {
          console.log('❌ Connection closed abnormally - likely auth issue')
        } else {
          console.log(`❌ Connection closed with code: ${event.code}`)
        }
      }
    } catch (err) {
      console.error('❌ Failed to create WebSocket:', err.message)
      resolve(false)
    }
  })
}

// Run tests
async function main() {
  console.log('=' .repeat(60))
  console.log('OpenAI Realtime API Access Test')
  console.log('='.repeat(60))
  console.log()

  const restAccess = await testRealtimeAccess()

  if (!restAccess) {
    console.log('\n' + '-'.repeat(60))
    console.log('\n📋 Next Steps if you don\'t have access:')
    console.log('1. Go to https://platform.openai.com/')
    console.log('2. Check your API plan/tier')
    console.log('3. Look for Realtime API beta signup')
    console.log('4. Make sure billing is set up')
  }

  console.log('\n' + '='.repeat(60))
}

main()
