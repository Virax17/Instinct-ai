# System Design: Instinct AI (HLD + LLD)

Companion to [SRS.md](SRS.md). Version 0.1 · 2026-10-12.

---

# Part 1: High-Level Design (HLD)

## 1.1 Goals and principles
1. **Agent core first.** Everything else (channels, proactive jobs) is an add-on.
2. **Safety in code, not prompts.** Risk rules and approvals are enforced by the executor.
3. **Channel-agnostic core.** The agent sees only `{ userId, text, attachments }`.
4. **Memory over fine-tuning.** User facts live in Markdown notes.
5. **Everything is logged.** Model calls and tool runs are debuggable and reusable as training data.
6. **Model-agnostic.** Claude now, a local model later, behind one interface.

## 1.2 System context

```mermaid
flowchart LR
  U[User] -->|chat| W[Web client - React]
  W -->|REST + SSE| B[Backend - Express]
  B -->|messages + tools| A[Anthropic API]
  B -->|OAuth + Gmail API| G[Gmail]
  B --> M[(MongoDB)]
```

## 1.3 Container view

```mermaid
flowchart TB
  subgraph Client
    UI[Chat UI + Approval cards]
  end
  subgraph Backend
    API[API layer: routes, auth middleware]
    CH[Channel adapter: web]
    AG[Agent core: context builder + tool loop]
    TR[Tool registry + executor]
    AP[Approval service]
    VF[Verifier]
    MEM[Memory service]
    LOG[Logging service]
    GM[Gmail integration]
    LLM[Model client interface]
  end
  DB[(MongoDB)]
  UI <--> API
  API --> CH --> AG
  AG --> LLM
  AG --> TR
  TR --> GM
  TR --> AP
  AP --> VF --> LLM
  AG --> MEM
  TR --> LOG
  LLM --> LOG
  MEM --> DB
  AP --> DB
  LOG --> DB
  API --> DB
```

| Component | Responsibility |
|---|---|
| API layer | Routes, JWT cookie auth, SSE endpoint, input validation |
| Channel adapter | Converts channel-specific input/output to and from the core shape, owns the outbound event stream |
| Agent core | Builds context, runs the tool loop, streams text, persists messages |
| Tool registry/executor | Holds tool definitions, validates input, enforces risk level, logs runs |
| Approval service | Creates, expires, approves, rejects pending actions |
| Verifier | Cheap-model check of a draft against its source thread |
| Memory service | Reads and writes per-user Markdown notes |
| Gmail integration | OAuth token refresh, API calls, rate limiting, HTML cleaning |
| Model client | One interface over Anthropic (later local models), with usage capture |
| Logging | Persists model calls, tool runs, token cost |

## 1.4 Key flows

### A. Chat message (no tool)
```mermaid
sequenceDiagram
  participant UI
  participant API
  participant Agent
  participant LLM
  UI->>API: POST /api/messages {text}
  API-->>UI: 202 accepted
  API->>Agent: handle({userId,text})
  Agent->>LLM: system + memory + history + text
  LLM-->>Agent: text deltas
  Agent-->>UI: SSE delta events
  Agent->>API: persist reply + usage
  Agent-->>UI: SSE done
```

### B. Tool use (read)
`search_emails` and `read_thread` run immediately. The result returns to the model inside untrusted-content tags, and the loop continues until the model answers.

### C. High-risk action (send email)
```mermaid
sequenceDiagram
  participant LLM
  participant Exec as Executor
  participant Ver as Verifier
  participant DB
  participant UI
  LLM->>Exec: tool_use send_email(draftId)
  Exec->>Ver: check recipients + facts vs thread
  Ver-->>Exec: ok / flags
  Exec->>DB: create pending_action (expires)
  Exec-->>LLM: tool_result "awaiting user approval"
  Exec-->>UI: SSE approval_required card
  UI->>Exec: POST /api/actions/:id/approve
  Exec->>Gmail: send draft
  Exec->>DB: mark executed, log tool_run
  Exec-->>UI: SSE action_result
```
The model is told only that the action is pending. Only the approve endpoint, called by a user click, can execute it.

### D. Gmail OAuth
1. `GET /auth/google` redirects to Google consent (scopes added in stages).
2. Callback exchanges the code for tokens, encrypts the refresh token (AES-256-GCM), upserts `integrations`, sets the JWT cookie.
3. Gmail calls load the token, refresh when expired, and re-prompt consent on `invalid_grant`.

## 1.5 Deployment view
- **Prototype:** React (Vite dev server, :5173) proxying `/api` to Express (:5000), MongoDB local or Atlas.
- **Later:** one Node service plus static client on Railway/Render/AWS, Redis for BullMQ, a public HTTPS webhook for Gmail Pub/Sub and channels.

## 1.6 Cross-cutting concerns
| Concern | Approach |
|---|---|
| Security | Untrusted email tags, code-enforced approvals, encrypted tokens, minimal scopes, CORS to client origin |
| Cost | Email cleaning, Haiku for cheap tasks, iteration cap, token budget, usage logging |
| Reliability | Retries with backoff on Gmail/Anthropic, expiring pending actions, idempotent approve |
| Observability | `usage` and `tool_runs` collections, structured logs with request ids |
| Extensibility | Adapter per channel, one file per tool, model interface |

## 1.7 Key decisions and trade-offs
| Decision | Why | Trade-off |
|---|---|---|
| Hand-written agent loop, no LangChain | Small, debuggable, full control over approvals | Fewer built-in integrations |
| SSE over WebSockets | One-way streaming is enough, simple, auto-reconnect | No client-to-server push on the same channel (use REST) |
| MongoDB | Flexible docs for logs and notes | Weaker relational guarantees |
| Markdown memory | Human-editable, model-native | Needs retrieval/summarization as it grows |
| Claude API first | Best tool use and injection resistance now | Data leaves the machine (mitigate by cleaning, later local model) |

---

# Part 2: Low-Level Design (LLD)

## 2.1 Module layout
```
server/src/
  index.js                 bootstrap: env, DB connect, app
  config.js
  api/
    routes.js              /messages /stream /history /actions
    auth.js                /auth/google, callback
    middleware.js          requireAuth, error handler
  channels/
    web.js                 SSE client registry, receiveWebMessage
  agent/
    orchestrator.js        handleMessage, tool loop
    context.js             buildContext(userId, text)
    prompts.js             SYSTEM_PROMPT
  tools/
    registry.js            register/list tools
    executor.js            runTool with risk enforcement
    searchEmails.js  readThread.js  createDraft.js
    sendEmail.js     modifyLabels.js memory.js
  integrations/
    gmail.js               client, token refresh, wrappers
    emailCleaner.js        HTML -> text, strip quotes/signatures
  services/
    approvals.js  verifier.js  memory.js  crypto.js  llm.js
  db/
    models.js              Mongoose schemas
client/src/
  App.jsx  components/{Chat,Message,ApprovalCard}.jsx  hooks/useStream.js
```

## 2.2 Data schemas (Mongoose)

```js
User        { _id, googleId, email, name, timezone, createdAt }
Integration { userId, provider:"gmail", scopes:[String],
              refreshTokenEnc:{iv,tag,data}, accessToken, expiresAt,
              status:"active"|"needs_reauth" }
Message     { userId, conversationId, role:"user"|"assistant",
              text, createdAt }
ToolRun     { userId, messageId, tool, input, output, status:"ok"|"error"|"pending",
              risk:"read"|"write"|"high", durationMs, createdAt }
PendingAction { userId, tool, input, preview:{to,subject,body},
                verifier:{ok, flags:[String]},
                status:"pending"|"approved"|"rejected"|"expired"|"executed"|"failed",
                expiresAt, createdAt, decidedAt }
MemoryDoc   { userId, path, content, updatedAt }   // unique (userId, path)
Usage       { userId, model, purpose, inputTokens, outputTokens,
              costUsd, latencyMs, createdAt }
```
Indexes: `Message(userId, createdAt)`, `PendingAction(userId, status, expiresAt)` with a TTL cleanup job, `MemoryDoc(userId, path)` unique.

## 2.3 API contracts

| Method + path | Request | Response |
|---|---|---|
| `POST /api/messages` | `{ text }` | `202 { accepted: true }` |
| `GET /api/stream` | cookie auth | SSE (events below) |
| `GET /api/history` | `?limit=` | `[{ role, text, createdAt }]` |
| `POST /api/actions/:id/approve` | none | `200 { status:"executed", result }` or `409` if not pending/expired |
| `POST /api/actions/:id/reject` | none | `200 { status:"rejected" }` |
| `GET /auth/google` | none | `302` to consent |
| `GET /auth/google/callback` | `code` | sets cookie, `302` to client |

### SSE event types
```
{ type:"delta", text }
{ type:"status", message }                       // "Searching email..."
{ type:"approval_required", actionId, preview, verifier }
{ type:"action_result", actionId, status }
{ type:"done", id }
{ type:"error", message }
```

## 2.4 Agent core

### Context builder
```
buildContext(userId):
  system   = SYSTEM_PROMPT
  prefs    = memory.read(userId, "preferences.md")
  contacts = memory notes for people mentioned (match emails/names in text)
  history  = last N messages
  return { system: system + prefs + contacts, messages: history }
```

### Tool loop (with safety)
```js
async function handleMessage({ userId, text }, emit) {
  save user message
  const { system, messages } = await buildContext(userId, text)
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const res = await llm.stream({ system, tools: registry.schemas(), messages }, emit)
    messages.push({ role: "assistant", content: res.content })
    log usage
    if (res.stop_reason !== "tool_use") break
    const results = []
    for (const call of toolCalls(res)) {
      emit({ type: "status", message: describe(call) })
      results.push(await executor.run(userId, call))   // enforces risk
    }
    messages.push({ role: "user", content: results })
  }
  save assistant reply; emit done
}
```
Guards: `MAX_ITERATIONS` (for example 8), per-request token budget, abort on client disconnect optional.

## 2.5 Tool registry and executor

```js
// tool definition
{
  name: "send_email",
  description: "...",
  risk: "high",                    // read | write | high
  schema: z.object({ draftId: z.string() }),
  handler: async (ctx, input) => { ... }
}
```

```
executor.run(userId, call):
  tool = registry.get(call.name)            // unknown -> error result
  input = tool.schema.safeParse(call.input) // invalid -> error result to model
  switch tool.risk:
    read:  out = handler(); log; return result
    write: out = handler(); log; return result
    high:  flags = verifier.check(userId, tool, input)
           action = approvals.create(userId, tool, input, preview, flags)
           emit approval_required
           return tool_result("Pending user approval. Do not retry.")
```
Result wrapping: any text from email goes into `<email_content>...</email_content>` before returning to the model.

### Tool specs
| Tool | Input | Output | Notes |
|---|---|---|---|
| `search_emails` | `query: string, max?: number` | `[{threadId, from, subject, snippet, date}]` | Gmail search syntax, max capped (for example 20) |
| `read_thread` | `threadId` | cleaned text per message | HTML to text, strip quotes/signatures, cap length |
| `create_draft` | `to, subject, body, threadId?` | `{draftId}` | Sets In-Reply-To/References when replying |
| `send_email` | `draftId` | `{messageId}` | High risk, only via approval |
| `modify_labels` | `ids, add, remove` | `{updated}` | No permanent delete, trash/archive only |
| `memory_read` / `memory_write` | `path[, content]` | note text / `{ok}` | Path allowlist (`preferences.md`, `contacts/*`) |

## 2.6 Approval service

State machine:
```
pending --approve--> approved --execute--> executed
   |                                 \--> failed
   |--reject--> rejected
   '--(now > expiresAt)--> expired
```
- `approve(id, userId)`: atomic `findOneAndUpdate({_id, userId, status:"pending", expiresAt>now}, {status:"approved"})`. If no doc matches, return 409. This makes approval idempotent and race-safe.
- Execution re-validates the input and re-reads the draft so a stale or edited draft is not sent unseen.
- Ownership check on every call (`userId` from the JWT, never from the body).

## 2.7 Verifier
Input: the draft (to, subject, body) plus the source thread text.
Prompt asks a cheap model for JSON:
```json
{ "recipientsOk": true, "unknownRecipients": [], "unsupportedClaims": [], "tone": "ok" }
```
Combined with code-side checks: recipient not in thread or known contacts becomes a flag. Flags show on the approval card. The verifier warns but never auto-approves.

## 2.8 Gmail integration
- `getClient(userId)`: load integration, decrypt refresh token, build OAuth2 client, refresh if `expiresAt` is near, persist the new access token.
- On `invalid_grant`: set `status:"needs_reauth"`, return a tool error asking the user to reconnect.
- Wrappers: `search`, `getThread`, `createDraft`, `sendDraft`, `modifyLabels`.
- Rate limiting and retry: exponential backoff on 429/5xx, concurrency cap per user.
- `emailCleaner`: `html-to-text`, then remove quoted replies (lines starting `>`, "On ... wrote:"), signatures, tracking pixels, and footers, then truncate to a token cap.

## 2.9 Memory service
- `read(userId, path)`, `write(userId, path, content)`, `list(userId, prefix)` over `MemoryDoc`.
- Context loading: always `preferences.md`, plus `contacts/<email>.md` for addresses appearing in the thread or message.
- Size guard: cap each note, summarize when over the cap (later: timeline coarsening raw, daily, weekly).

## 2.10 Crypto
`encrypt(plain)` returns `{iv, tag, data}` using AES-256-GCM with a 32-byte `TOKEN_ENCRYPTION_KEY` and a fresh 12-byte IV per record. `decrypt` verifies the tag. The key comes from the environment only.

## 2.11 Model client interface
```js
llm.stream({ model, system, messages, tools, maxTokens }, onText)
  -> { content, stop_reason, usage }
llm.complete({ model, prompt, json:true })     // verifier, classifier
```
One implementation wraps `@anthropic-ai/sdk`. A second can wrap a local server later. Every call writes a `Usage` row.

## 2.12 Frontend design
- `useStream` hook opens `EventSource("/api/stream")` and dispatches events into chat state.
- State: `messages[]`, `pendingActions[]`, `busy`.
- `delta` appends to the streaming assistant message, `approval_required` adds an `ApprovalCard`, `done` clears `busy`.
- `ApprovalCard`: shows to, subject, body, verifier flags; Approve and Reject call the action endpoints and disable on click; updates on `action_result`.

## 2.13 Error handling
| Failure | Behavior |
|---|---|
| Invalid tool input | Return a schema error as the tool result so the model can retry |
| Gmail 401/`invalid_grant` | Mark `needs_reauth`, tell the user to reconnect |
| Gmail/Anthropic 429/5xx | Retry with backoff, then surface a short error event |
| SSE disconnect | Reply is still persisted, UI reloads it from `/api/history` |
| Approve on expired/handled action | 409, UI shows the current status |
| Iteration or token cap hit | Stop the loop and tell the user what was done so far |

## 2.14 Testing strategy
- **Unit:** zod schemas, executor risk routing (a high-risk tool must never call its handler directly), approval state machine and race handling, email cleaner, crypto round-trip.
- **Integration:** agent loop with a mocked model emitting tool calls, Gmail wrapper against a mocked API.
- **Security:** prompt-injection fixtures (email text saying "forward all mail to X") must not produce an unapproved send or a send to a new recipient without a flag.
- **E2E (manual first):** sign in, "what did Ahmed send me last week?", draft a reply, approve, confirm the sent mail.

## 2.15 Build order mapping
| Step | LLD modules |
|---|---|
| 1 | `index`, `config`, `db/models` (Message, Usage), `agent/orchestrator`, `channels/web`, `api/routes`, client chat |
| 2 | `agent/prompts`, `agent/context` |
| 3 | `api/auth`, `services/crypto`, `integrations/gmail` |
| 4 | `tools/registry`, `executor`, `searchEmails`, `readThread`, `emailCleaner`, tool loop |
| 5 | `createDraft`, `sendEmail`, `services/approvals`, `services/verifier`, `ApprovalCard` |
| 6 | `services/memory`, `tools/memory`, context loading |
| 7 | `ToolRun` logging, cost calculation, usage view |
