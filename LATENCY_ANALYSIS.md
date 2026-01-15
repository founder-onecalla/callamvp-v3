# OneCalla Latency Analysis

## Executive Summary

The most critical latency path is **Voice Agent Response** (person speaks → AI responds), which currently has **6 sequential operations** totaling an estimated **3-6 seconds**. This is too slow for natural conversation.

---

## 1. Voice Agent Response Latency (CRITICAL)

**Path:** Person speaks → AI responds audibly

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ CURRENT FLOW (Sequential - ~3-6 seconds)                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Person speaks                                                              │
│       ↓                                                                     │
│  [~500-1000ms] Telnyx transcription processing                              │
│       ↓                                                                     │
│  [~100ms] Webhook receives transcription                                    │
│       ↓                                                                     │
│  [~50ms] Insert transcription to DB                                         │
│       ↓                                                                     │
│  [~100ms] HTTP call to voice-agent function                                 │
│       ↓                                                                     │
│  [~200ms] Edge function cold start (if cold)                                │
│       ↓                                                                     │
│  [~100ms] 4 sequential DB queries (call, context, transcriptions, events)   │
│       ↓                                                                     │
│  [~1000-2000ms] GPT-4 API call                                              │
│       ↓                                                                     │
│  [~500-1000ms] ElevenLabs TTS (UNUSED - we use Telnyx speak)                │
│       ↓                                                                     │
│  [~200ms] Telnyx speak API call                                             │
│       ↓                                                                     │
│  [~50ms] Insert agent_speech event to DB                                    │
│       ↓                                                                     │
│  [~300-500ms] Telnyx TTS rendering + playback start                         │
│       ↓                                                                     │
│  Person hears AI response                                                   │
│                                                                             │
│  TOTAL: ~3000-6000ms (unacceptable for conversation)                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Issues Identified:

| Issue | Location | Impact | Fix |
|-------|----------|--------|-----|
| 4 sequential DB queries | voice-agent:176-210 | +400ms | Parallelize with Promise.all() |
| ElevenLabs called but unused | voice-agent:268 | +500-1000ms | Remove (using Telnyx speak) |
| GPT-4-turbo is slow | voice-agent:97 | +1000-2000ms | Use GPT-4o or GPT-3.5-turbo |
| Cold start penalty | Edge function | +200ms | Keep warm or use streaming |
| No streaming response | voice-agent | +latency | Stream GPT → Telnyx |

### Recommended Optimizations:

```typescript
// BEFORE: Sequential queries (~400ms)
const { data: call } = await serviceClient.from('calls')...
const { data: context } = await serviceClient.from('call_contexts')...
const { data: transcriptions } = await serviceClient.from('transcriptions')...
const { data: agentEvents } = await serviceClient.from('call_events')...

// AFTER: Parallel queries (~100ms)
const [callResult, contextResult, transcriptionsResult, eventsResult] = await Promise.all([
  serviceClient.from('calls').select('*').eq('id', call_id).single(),
  serviceClient.from('call_contexts').select('*').eq('call_id', call_id).maybeSingle(),
  serviceClient.from('transcriptions').select('*').eq('call_id', call_id).order('created_at'),
  serviceClient.from('call_events').select('*').eq('call_id', call_id).eq('event_type', 'agent_speech').order('created_at')
])
```

```typescript
// BEFORE: GPT-4-turbo (~1500ms average)
model: 'gpt-4-turbo-preview'

// AFTER: GPT-4o (~500ms average) or GPT-3.5-turbo (~300ms)
model: 'gpt-4o'  // Faster, same quality for short responses
```

```typescript
// REMOVE: ElevenLabs TTS is generated but never used
const audioBuffer = await textToSpeech(elevenLabsKey, responseText)  // DELETE THIS LINE
```

---

## 2. Chat Response Latency

**Path:** User types message → AI response appears

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ CURRENT FLOW (~1.5-3 seconds)                                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  User sends message                                                         │
│       ↓                                                                     │
│  [~100ms] Supabase function invoke                                          │
│       ↓                                                                     │
│  [~200ms] Edge function cold start (if cold)                                │
│       ↓                                                                     │
│  [~50ms] Auth validation                                                    │
│       ↓                                                                     │
│  [~100ms] 3 sequential DB queries (memories, contacts, IVR paths)           │
│       ↓                                                                     │
│  [~1000-2000ms] GPT-4 API call                                              │
│       ↓                                                                     │
│  [~50ms] Execute any function calls (save_memory, etc.)                     │
│       ↓                                                                     │
│  [~50ms] Store messages in DB                                               │
│       ↓                                                                     │
│  Response displayed                                                         │
│                                                                             │
│  TOTAL: ~1500-3000ms (acceptable but could improve)                         │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Optimizations:

| Issue | Fix | Savings |
|-------|-----|---------|
| Sequential DB queries | Parallelize getUserContext() | ~100ms |
| GPT-4-turbo | Use GPT-4o | ~500ms |
| No streaming | Implement SSE streaming | Perceived -1000ms |

---

## 3. Call Initiation Latency

**Path:** User confirms → Phone rings

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ CURRENT FLOW (~1-2 seconds)                                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  User says "yes"                                                            │
│       ↓                                                                     │
│  [~1500ms] Chat function processes, returns place_call                      │
│       ↓                                                                     │
│  [~100ms] Frontend calls call-start function                                │
│       ↓                                                                     │
│  [~50ms] Auth + create call record                                          │
│       ↓                                                                     │
│  [~200ms] Telnyx API initiates call                                         │
│       ↓                                                                     │
│  [~50ms] Update call with telnyx_call_id                                    │
│       ↓                                                                     │
│  Phone starts ringing                                                       │
│                                                                             │
│  TOTAL: ~1900ms (acceptable)                                                │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Transcription Display Latency

**Path:** Person speaks → Text appears in UI

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ CURRENT FLOW (~1-2 seconds)                                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Person speaks                                                              │
│       ↓                                                                     │
│  [~500-1000ms] Telnyx STT processing                                        │
│       ↓                                                                     │
│  [~100ms] Webhook receives event                                            │
│       ↓                                                                     │
│  [~50ms] Insert to transcriptions table                                     │
│       ↓                                                                     │
│  [~100-200ms] Supabase Realtime propagation                                 │
│       ↓                                                                     │
│  [~50ms] React state update + render                                        │
│       ↓                                                                     │
│  Text appears in UI                                                         │
│                                                                             │
│  TOTAL: ~800-1500ms (acceptable for display)                                │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Post-Call Summary Latency

**Path:** Call ends → Summary displayed

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ CURRENT FLOW (~2-4 seconds)                                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Call ends (hangup event)                                                   │
│       ↓                                                                     │
│  [~100ms] Webhook updates call status                                       │
│       ↓                                                                     │
│  [~100ms] Realtime notifies frontend                                        │
│       ↓                                                                     │
│  [~100ms] Frontend calls call-summary function                              │
│       ↓                                                                     │
│  [~200ms] 4 sequential DB queries                                           │
│       ↓                                                                     │
│  [~1500-2500ms] GPT-4 generates summary                                     │
│       ↓                                                                     │
│  [~50ms] Store summary message                                              │
│       ↓                                                                     │
│  Summary displayed                                                          │
│                                                                             │
│  TOTAL: ~2000-4000ms (acceptable, not time-critical)                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Optimizations:

| Issue | Fix | Savings |
|-------|-----|---------|
| Sequential DB queries | Parallelize | ~150ms |
| GPT-4-turbo | Use GPT-4o or GPT-3.5-turbo | ~500-1000ms |

---

## 6. Call History Load Latency

**Path:** Opens history → Data appears

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ CURRENT FLOW (~200-500ms)                                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  User expands call history                                                  │
│       ↓                                                                     │
│  [~100-300ms] Supabase query with JOIN                                      │
│       ↓                                                                     │
│  [~50ms] React state update                                                 │
│       ↓                                                                     │
│  [~50ms] Render cards                                                       │
│       ↓                                                                     │
│  History displayed                                                          │
│                                                                             │
│  TOTAL: ~200-500ms (good)                                                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Priority Fixes

### 🔴 Critical (Voice Agent - affects conversation quality)

1. **Remove unused ElevenLabs call** - Saves 500-1000ms
2. **Parallelize DB queries** - Saves ~300ms
3. **Switch to GPT-4o** - Saves ~500-1000ms
4. **Total potential savings: 1.3-2.3 seconds**

### 🟡 Important (Chat - affects UX)

1. **Parallelize getUserContext()** - Saves ~100ms
2. **Switch to GPT-4o** - Saves ~500ms
3. **Consider streaming responses** - Perceived improvement

### 🟢 Nice to Have

1. **Edge function warm-up** - Saves cold start penalty
2. **Response caching** - For repeated queries
3. **Optimistic UI updates** - Perceived improvement

---

## Benchmark Targets

| Operation | Current | Target | Status |
|-----------|---------|--------|--------|
| Voice Agent Response | 3-6s | <1.5s | 🔴 Critical |
| Chat Response | 1.5-3s | <1s | 🟡 Needs work |
| Call Initiation | ~2s | <2s | 🟢 OK |
| Transcription Display | 1-1.5s | <1s | 🟢 OK |
| Post-Call Summary | 2-4s | <2s | 🟡 Nice to have |
| Call History Load | 0.2-0.5s | <0.5s | 🟢 OK |

---

## Implementation Priority

1. **voice-agent optimization** (HIGHEST IMPACT)
   - Remove ElevenLabs call
   - Parallelize queries
   - Switch model

2. **chat optimization**
   - Parallelize queries
   - Switch model

3. **call-summary optimization**
   - Parallelize queries
   - Consider GPT-3.5-turbo (simpler task)
