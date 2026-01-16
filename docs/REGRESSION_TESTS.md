# Regression Test Checklist

This document contains the required tests that must pass before shipping changes.

## 1. Recap State Consistency

### Test 1.1: Cannot show unavailable and recap simultaneously
**Steps:**
1. Make a call that connects and has conversation
2. Wait for recap to generate
3. Observe the UI

**Expected:**
- If `recap_status === 'recap_ready'` → UI shows recap content, NO "unavailable" message
- If `recap_status === 'recap_failed_*'` → UI shows error message, NO recap content
- These states are MUTUALLY EXCLUSIVE

**Verification:**
```sql
-- Check call record
SELECT id, recap_status, recap_error_code FROM calls WHERE id = 'xxx';
```

### Test 1.2: Retry always changes state to pending immediately
**Steps:**
1. Trigger a recap failure (e.g., by rate limiting)
2. Click "Retry recap" button
3. Observe immediate state change

**Expected:**
- Button should show spinner immediately after click
- `recap_status` in DB should change to `recap_pending` within 100ms
- UI should show "Generating recap..." immediately
- No dead click - always visual feedback

## 2. Recap Quality

### Test 2.1: Exact time extraction from transcript
**Setup:** Transcript contains: "I'll be home by 1:00 p.m."

**Expected outcome sentence:**
- ✅ "Sarah said she will be home around 1:00 p.m."
- ❌ "Call ended. Key mention: 1."
- ❌ "Time: 00 (uncertain)"

### Test 2.2: Date ambiguity handling
**Setup:** Transcript contains: "I'll be there around 3 tomorrow"

**Expected outcome sentence:**
- ✅ "Sarah said she will be there tomorrow around 3:00 p.m."
- ✅ "Sarah mentioned around 3:00 p.m., but the date wasn't specified."
- ❌ "Time mentioned: 3"

### Test 2.3: Minimum meaningful sentence
**Requirement:** No recap should be shorter than a meaningful sentence (15+ chars)

**Verify:**
```sql
SELECT id, summary FROM calls
WHERE recap_status = 'recap_ready'
AND (summary IS NULL OR LENGTH(summary) < 15);
-- Should return 0 rows
```

## 3. Natural Conversation Pacing

### Test 3.1: First line must be short
**Setup:** Make a call with known recipient name "Sarah"

**Expected first utterance:**
- ✅ "Hi, is this Sarah?"
- ❌ "Hi Sarah, I'm calling on behalf of David, a friend of yours, with a message..."

**Verification:** Check call_events for first agent_speech entry:
```sql
SELECT description FROM call_events
WHERE call_id = 'xxx' AND event_type = 'agent_speech'
ORDER BY created_at ASC LIMIT 1;
-- Should be max 30 chars
```

### Test 3.2: No "a friend" without name
**Requirement:** Agent must never say "on behalf of a friend" without the actual caller name

**Expected with caller name "David":**
- ✅ "This is David's assistant calling..."
- ❌ "I'm calling on behalf of a friend..."

### Test 3.3: Graceful exit when challenged
**Setup:** Callee responds with "Who is this?" or "Why are you calling?"

**Expected:**
- Agent should exit gracefully within 1-2 utterances
- ✅ "No worries! Have a great day!"
- ❌ Continuing to push the conversation

## 4. Call Pipeline Reliability

### Test 4.1: All checkpoints logged in normal call
**Requirement:** For a successful call, these checkpoints must exist:

```sql
SELECT pipeline_checkpoints FROM calls WHERE id = 'xxx';
-- Must contain:
-- - call_started
-- - call_answered
-- - first_tts_started
-- - first_tts_completed
-- - first_audio_received (or first_asr_partial/final)
-- - call_ended
```

### Test 4.2: Reprompt after 3 seconds of silence
**Setup:** Call connects, agent speaks, callee doesn't respond for 3+ seconds

**Expected:**
- After 3 seconds: Agent says "Sorry, I didn't catch that. Could you repeat?"
- After second failure: Graceful exit "I'll follow up another time. Have a great day!"

**Verification:**
```sql
SELECT * FROM call_events
WHERE call_id = 'xxx' AND event_type = 'checkpoint' AND description LIKE '%silence%';
```

### Test 4.3: Never more than 3 seconds of silence without feedback
**Requirement:** Call must never sit silent for >3 seconds without:
- Reprompt
- Listening UI feedback
- Agent speaking

## 5. "Hi there" Silence Bug - Diagnosis Checklist

When a call exhibits this bug (agent says greeting then goes silent):

### Step A: Check webhook delivery
```sql
SELECT * FROM call_events
WHERE call_id = 'xxx'
ORDER BY created_at;
-- Verify 'call_answered' event exists
```

### Step B: Check transcription started
Look for checkpoint `transcription_started` in events.

### Step C: Check voice-agent invocation
Look for checkpoint `first_tts_started` and `first_tts_completed`.

### Step D: Check ASR events
Look for checkpoints `first_asr_partial` or `first_asr_final`.

**Failure buckets:**
| Missing Checkpoint | Likely Cause |
|--------------------|--------------|
| call_answered | Telnyx webhook not configured |
| transcription_started | Telnyx transcription API failed |
| first_tts_* | voice-agent function crashed or timeout |
| first_asr_* | Telnyx not sending audio, wrong track config |

---

## Deployment Checklist

Before deploying, verify:

- [ ] Run migration: `supabase db push` or apply SQL manually
- [ ] Deploy functions: `npx supabase functions deploy call-summary voice-agent webhook-telnyx`
- [ ] Build and deploy frontend: `npm run build && npx vercel --prod`
- [ ] Test one call end-to-end
- [ ] Verify recap generates with correct status
- [ ] Check Supabase function logs for errors

## Known Failure Causes for "Hi there" Bug

Based on investigation:

1. **Telnyx webhook URL not configured**: webhook-telnyx receives 0 invocations
   - Fix: Configure webhook URL in Telnyx Mission Control Portal

2. **Transcription not started**: `transcription_start` API call failed
   - Fix: Check Telnyx API key permissions

3. **Voice-agent timeout**: Function takes >30s to respond
   - Fix: Optimize database queries, reduce payload size

4. **ASR track misconfiguration**: Only capturing "self" track not "leg" track
   - Fix: Use `transcription_tracks: 'both'`

---

## P0: Inbound Audio Diagnosis (Added 2024-01-17)

### Problem
Calls connect, TTS plays, but we don't receive transcription from the callee's side.
We only get `leg: 'self'` transcription events (our TTS), not `leg: 'leg'` events (callee).

### Diagnostic Instrumentation Added
1. **Full transcription event logging**: All transcription events now log the complete payload
2. **inbound_audio_health tracking**: Each call tracks:
   - `transcription_started`: Whether transcription_start succeeded
   - `self_transcripts_received`: Count of our TTS transcriptions
   - `remote_transcripts_received`: Count of callee transcriptions
   - `last_remote_leg_value`: What leg value Telnyx sends for remote party

### How to Diagnose

1. **Make a test call** and have the callee speak

2. **Check Supabase Function Logs** for webhook-telnyx:
   ```
   Look for:
   - "========== TRANSCRIPTION EVENT =========="
   - "FULL payload:" - shows the complete Telnyx event
   - "leg:" value - should see both 'self' and something else ('leg', 'outbound', etc.)
   - "🎤 REMOTE AUDIO RECEIVED!" - confirms we got callee audio
   ```

3. **Check the call record** in Supabase:
   ```sql
   SELECT id, inbound_audio_health FROM calls WHERE id = 'xxx';
   ```
   - If `remote_transcripts_received = 0`, Telnyx isn't sending us callee transcription
   - Check `last_remote_leg_value` to see what leg value Telnyx uses

### Common Root Causes

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| transcription_start_failed checkpoint | Telnyx API error | Check API key, connection settings |
| self_transcripts > 0, remote = 0 | Telnyx not transcribing outbound track | Check Telnyx connection config, try `transcription_tracks: 'outbound'` |
| No transcription events at all | Transcription not enabled on connection | Enable in Telnyx Mission Control |
| Transcriptions arrive but leg value wrong | Our code checking wrong value | Update leg comparison logic |

### Telnyx Configuration Checklist

1. **Connection Settings** (Mission Control > Connections):
   - [ ] Transcription is enabled
   - [ ] Both tracks are available
   - [ ] Media handling set correctly

2. **Webhook URL** (should be shown in call-start logs):
   - [ ] URL is publicly accessible
   - [ ] Telnyx can reach it (check Telnyx webhook delivery logs)

3. **Transcription API Response** (in function logs):
   - [ ] Status 200 from transcription_start
   - [ ] Response body doesn't indicate errors
