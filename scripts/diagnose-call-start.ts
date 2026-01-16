/**
 * Diagnostic script for call-start issues
 * Run with: npx ts-node scripts/diagnose-call-start.ts
 * 
 * This script checks:
 * 1. Environment variables are set
 * 2. Telnyx API credentials are valid
 * 3. Telnyx connection is configured correctly
 * 4. Webhook URL is accessible
 */

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const TELNYX_API_KEY = process.env.TELNYX_API_KEY
const TELNYX_CONNECTION_ID = process.env.TELNYX_CONNECTION_ID
const TELNYX_PHONE_NUMBER = process.env.TELNYX_PHONE_NUMBER
const SUPABASE_URL = process.env.VITE_SUPABASE_URL

async function diagnose() {
  console.log('🔍 Call Start Diagnostics\n')
  console.log('=' .repeat(50))
  
  // Check environment variables
  console.log('\n1️⃣ Environment Variables:')
  console.log(`   TELNYX_API_KEY: ${TELNYX_API_KEY ? '✅ Set (' + TELNYX_API_KEY.substring(0, 10) + '...)' : '❌ Missing'}`)
  console.log(`   TELNYX_CONNECTION_ID: ${TELNYX_CONNECTION_ID ? '✅ Set (' + TELNYX_CONNECTION_ID + ')' : '❌ Missing'}`)
  console.log(`   TELNYX_PHONE_NUMBER: ${TELNYX_PHONE_NUMBER ? '✅ Set (' + TELNYX_PHONE_NUMBER + ')' : '❌ Missing'}`)
  console.log(`   SUPABASE_URL: ${SUPABASE_URL ? '✅ Set' : '❌ Missing'}`)

  if (!TELNYX_API_KEY) {
    console.log('\n❌ Cannot continue - TELNYX_API_KEY is required')
    return
  }

  // Check Telnyx account
  console.log('\n2️⃣ Telnyx API Credentials:')
  try {
    const response = await fetch('https://api.telnyx.com/v2/balance', {
      headers: {
        'Authorization': `Bearer ${TELNYX_API_KEY}`,
        'Content-Type': 'application/json',
      },
    })
    
    if (response.ok) {
      const data = await response.json()
      console.log(`   API Key: ✅ Valid`)
      console.log(`   Account Balance: ${data.data?.balance || 'Unknown'} ${data.data?.currency || ''}`)
      
      if (data.data?.balance && parseFloat(data.data.balance) <= 0) {
        console.log('   ⚠️ WARNING: Account balance is zero or negative!')
      }
    } else {
      const error = await response.text()
      console.log(`   API Key: ❌ Invalid (${response.status})`)
      console.log(`   Error: ${error}`)
    }
  } catch (err) {
    console.log(`   API Key: ❌ Check failed - ${err}`)
  }

  // Check Telnyx connection
  console.log('\n3️⃣ Telnyx Connection:')
  if (TELNYX_CONNECTION_ID) {
    try {
      // First try to list connections to verify API access
      const listResponse = await fetch('https://api.telnyx.com/v2/credential_connections', {
        headers: {
          'Authorization': `Bearer ${TELNYX_API_KEY}`,
          'Content-Type': 'application/json',
        },
      })
      
      if (listResponse.ok) {
        const listData = await listResponse.json()
        console.log(`   Found ${listData.data?.length || 0} credential connections`)
        
        // Check if our connection ID is in the list
        const connection = listData.data?.find((c: any) => c.id === TELNYX_CONNECTION_ID)
        if (connection) {
          console.log(`   Connection "${connection.connection_name || 'unnamed'}": ✅ Found`)
          console.log(`   Active: ${connection.active ? '✅ Yes' : '❌ No'}`)
          console.log(`   Webhook Event URL: ${connection.webhook_event_url || 'Not set'}`)
        } else {
          // Try FQDN connections
          const fqdnResponse = await fetch('https://api.telnyx.com/v2/fqdn_connections', {
            headers: {
              'Authorization': `Bearer ${TELNYX_API_KEY}`,
              'Content-Type': 'application/json',
            },
          })
          
          if (fqdnResponse.ok) {
            const fqdnData = await fqdnResponse.json()
            const fqdnConn = fqdnData.data?.find((c: any) => c.id === TELNYX_CONNECTION_ID)
            if (fqdnConn) {
              console.log(`   FQDN Connection "${fqdnConn.connection_name || 'unnamed'}": ✅ Found`)
              console.log(`   Active: ${fqdnConn.active ? '✅ Yes' : '❌ No'}`)
            } else {
              console.log(`   Connection ID: ❌ Not found in credential or FQDN connections`)
              console.log(`   ⚠️ The CONNECTION_ID might be incorrect`)
            }
          }
        }
      } else {
        console.log(`   Connection check: ❌ Failed (${listResponse.status})`)
      }
    } catch (err) {
      console.log(`   Connection check: ❌ Error - ${err}`)
    }
  } else {
    console.log(`   Connection: ❌ TELNYX_CONNECTION_ID not set`)
  }

  // Check phone number
  console.log('\n4️⃣ Telnyx Phone Number:')
  if (TELNYX_PHONE_NUMBER) {
    try {
      // Validate format
      if (!TELNYX_PHONE_NUMBER.startsWith('+')) {
        console.log(`   Format: ❌ Must start with + (E.164 format)`)
      } else {
        console.log(`   Format: ✅ Valid E.164 format`)
      }
      
      // Check if we own this number
      const numbersResponse = await fetch('https://api.telnyx.com/v2/phone_numbers?filter[phone_number]=' + encodeURIComponent(TELNYX_PHONE_NUMBER), {
        headers: {
          'Authorization': `Bearer ${TELNYX_API_KEY}`,
          'Content-Type': 'application/json',
        },
      })
      
      if (numbersResponse.ok) {
        const numbersData = await numbersResponse.json()
        if (numbersData.data?.length > 0) {
          const number = numbersData.data[0]
          console.log(`   Ownership: ✅ Number belongs to account`)
          console.log(`   Status: ${number.status}`)
          console.log(`   Connection ID: ${number.connection_id || 'Not assigned to connection'}`)
          
          if (number.connection_id && number.connection_id !== TELNYX_CONNECTION_ID) {
            console.log(`   ⚠️ WARNING: Number is assigned to a different connection!`)
            console.log(`   Number's connection: ${number.connection_id}`)
            console.log(`   Your TELNYX_CONNECTION_ID: ${TELNYX_CONNECTION_ID}`)
          }
        } else {
          console.log(`   Ownership: ❌ Number not found in account`)
          console.log(`   ⚠️ Make sure you own this number in your Telnyx account`)
        }
      } else {
        console.log(`   Number check: ❌ Failed (${numbersResponse.status})`)
      }
    } catch (err) {
      console.log(`   Number check: ❌ Error - ${err}`)
    }
  } else {
    console.log(`   Phone number: ❌ TELNYX_PHONE_NUMBER not set`)
  }

  // Check webhook URL
  console.log('\n5️⃣ Webhook URL:')
  if (SUPABASE_URL) {
    const webhookUrl = `${SUPABASE_URL}/functions/v1/webhook-telnyx`
    console.log(`   URL: ${webhookUrl}`)
    
    try {
      const response = await fetch(webhookUrl, { method: 'GET' })
      if (response.ok) {
        console.log(`   Accessibility: ✅ Webhook endpoint is reachable`)
      } else {
        console.log(`   Accessibility: ⚠️ Returned ${response.status} (may still work for POST)`)
      }
    } catch (err) {
      console.log(`   Accessibility: ❌ Not reachable - ${err}`)
      console.log(`   ⚠️ This could cause call failures!`)
    }
  } else {
    console.log(`   ❌ Cannot check - SUPABASE_URL not set`)
  }

  // Summary
  console.log('\n' + '=' .repeat(50))
  console.log('📋 Summary:')
  console.log('   Check the Supabase Edge Function logs for detailed errors:')
  console.log('   https://supabase.com/dashboard/project/dkxhtrwwgniontcjpomi/functions/call-start/logs')
  console.log('\n   Common issues:')
  console.log('   1. Telnyx account balance is zero')
  console.log('   2. Phone number not assigned to the connection')
  console.log('   3. Connection not active or misconfigured')
  console.log('   4. Webhook URL not accessible from Telnyx')
}

diagnose().catch(console.error)
