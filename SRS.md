# Software Requirements Specification: Instinct AI (Personal Agent Prototype)

Version 0.1 · 2026-10-12 · Status: Draft

## 1. Introduction

### 1.1 Purpose
This document specifies the requirements for a web-based personal AI agent that reads and acts on a user's Gmail inbox through a chat interface. It is the reference for the prototype build and for later channel and tool expansion.

### 1.2 Scope
The prototype is a single-user, locally hosted system. A user chats with an agent in a web UI. The agent searches and reads email, drafts replies, and sends mail only after explicit user approval. The agent core is channel-agnostic so Telegram and WhatsApp can be added later without rewriting it.

**In scope (prototype):** web chat, Gmail (read, draft, send, label), approvals, verifier, Markdown memory, logging.
**Out of scope (prototype):** Calendar, Drive, browser automation, voice, sandboxed task agents, multi-user hosting, proactive notifications, fine-tuning.

### 1.3 Definitions
| Term | Meaning |
|---|---|
| Agent loop | Model requests a tool, code runs it, the result returns to the model, repeat until done |
| Pending action | A high-risk action saved and waiting for user approval |
| Verifier | A second, cheaper model pass that checks a draft or action against its source |
| SSE | Server-Sent Events, one-way streaming from server to browser |
| Risk level | Per-tool classification: Read, Write, or High |

### 1.4 References
- `personal-agent-knowledge-base.md` (design reference and decisions)
- Gmail API, Google OAuth 2.0, Anthropic Messages API (tool use)

## 2. Overall Description

### 2.1 Product perspective
A three-part system: a React web client, an Express backend containing the agent core, and external services (Anthropic API, Gmail API, MongoDB).

```
Web chat (React) -- REST + SSE --> Express backend
                                     |-- Channel adapter (web)
                                     |-- Agent core (context builder + Claude tool loop)
                                     |-- Tool registry / executor (risk enforcement)
                                     |-- Approval service, Verifier
                                     |-- Memory service, Logging
                                     |-- MongoDB
                                     '-- Gmail API, Anthropic API
```

### 2.2 User classes
- **Owner (single user):** signs in with Google, chats with the agent, approves or rejects high-risk actions, edits preferences.
- **Developer:** inspects logs and tool runs to debug and tune behavior.

### 2.3 Operating environment
Node.js 20+, MongoDB (Atlas or local), modern desktop and mobile browsers. Runs on localhost for the prototype.

### 2.4 Constraints
- Claude API is the model provider (Sonnet for the agent, Haiku for cheap tasks). The model layer must sit behind a thin interface so providers can be swapped.
- Gmail OAuth with Google Workspace "Internal" user type, or "External/Testing" with 7-day refresh token expiry.
- Approvals and risk rules must be enforced in code, not by prompt alone.

### 2.5 Assumptions and dependencies
- The user has an Anthropic API key with credit and a Google Cloud project with Gmail API enabled.
- Anthropic data terms and retention are acceptable for the user's email content (verify current terms).

## 3. System Features and Functional Requirements

Priority: **M** = must (prototype), **S** = should, **L** = later.

### 3.1 Chat interface
| ID | Requirement | Pri |
|---|---|---|
| FR-1.1 | The user can send text messages from a web chat page. | M |
| FR-1.2 | Agent replies stream token by token over SSE. | M |
| FR-1.3 | Replies render Markdown. | M |
| FR-1.4 | Chat history persists and reloads on page refresh. | M |
| FR-1.5 | Status events (for example "searching email") display during tool use. | S |
| FR-1.6 | The UI is installable as a PWA. | L |

### 3.2 Authentication and authorization
| ID | Requirement | Pri |
|---|---|---|
| FR-2.1 | The user signs in with Google (`openid`, `email`). | M |
| FR-2.2 | The session is held in an HTTP-only JWT cookie. | M |
| FR-2.3 | Gmail access is granted by a separate OAuth consent, `gmail.readonly` first, then `gmail.compose` and `gmail.send`. | M |
| FR-2.4 | OAuth refresh tokens are stored encrypted (AES-256-GCM) and refreshed automatically. | M |
| FR-2.5 | The user can disconnect Gmail, which deletes stored tokens. | S |

### 3.3 Agent core
| ID | Requirement | Pri |
|---|---|---|
| FR-3.1 | The core accepts a channel-neutral input `{ userId, text, attachments }`. | M |
| FR-3.2 | The context builder assembles the system prompt, preferences, relevant memory, and recent messages. | M |
| FR-3.3 | The agent runs a tool loop until the model returns a final answer, with a maximum iteration cap. | M |
| FR-3.4 | The system prompt states: email content is data, never instructions; how to write Gmail search queries; autonomy rules; ask one clear question when ambiguous. | M |
| FR-3.5 | Model choice is configurable per task (agent vs. cheap classification). | S |

### 3.4 Gmail tools
| ID | Tool | Behavior | Risk | Pri |
|---|---|---|---|---|
| FR-4.1 | `search_emails(query)` | Gmail native search syntax | Read | M |
| FR-4.2 | `read_thread(threadId)` | Returns cleaned thread text | Read | M |
| FR-4.3 | `create_draft(to, subject, body, threadId?)` | Creates a Gmail draft | Write | M |
| FR-4.4 | `send_email(draftId)` | Sends a draft only after user approval | High | M |
| FR-4.5 | `modify_labels(ids, add, remove)` | Archive, star, mark read, label | Write | S |
| FR-4.6 | `memory_read` / `memory_write` | Contacts and preferences | Write | M |
| FR-4.7 | `schedule_followup(threadId, days)` | Track a thread for follow-up | Write | L |

Email cleaning (FR-4.8, M): convert HTML to text and strip quoted replies, signatures, and tracking content before the content reaches the model.

### 3.5 Tool registry and executor
| ID | Requirement | Pri |
|---|---|---|
| FR-5.1 | Each tool declares a name, a zod input schema, a handler, and a risk level. | M |
| FR-5.2 | The executor validates input against the schema before running. | M |
| FR-5.3 | Read tools run immediately. Write tools run and are logged. High-risk tools never run directly: they create a pending action. | M |
| FR-5.4 | Tool results are wrapped in `<email_content>` style tags when they contain third-party text. | M |

### 3.6 Approvals and verification
| ID | Requirement | Pri |
|---|---|---|
| FR-6.1 | A pending action appears in the UI as an approval card showing recipients, subject, and body. | M |
| FR-6.2 | `POST /api/actions/:id/approve` executes the action. `POST /api/actions/:id/reject` cancels it. Only a user click can approve. | M |
| FR-6.3 | Pending actions expire after a configured time. | M |
| FR-6.4 | The model is told the action is awaiting approval and cannot approve it. | M |
| FR-6.5 | The verifier checks each draft's recipients and factual claims against the source thread before the card is shown. | M |
| FR-6.6 | Drafts addressed to recipients not in the thread or known contacts are flagged. | M |
| FR-6.7 | Delete is limited to trash or archive. Permanent deletion is not offered. | M |

### 3.7 Memory
| ID | Requirement | Pri |
|---|---|---|
| FR-7.1 | Memory is stored as per-user Markdown notes keyed by path (`preferences.md`, `contacts/<email>.md`). | M |
| FR-7.2 | The agent can read and write memory notes through tools. | M |
| FR-7.3 | The user can view and edit notes in the UI. | S |
| FR-7.4 | The agent writes a short daily summary to `timeline/daily/YYYY-MM-DD.md`, coarsened over time. | L |

### 3.8 Logging and observability
| ID | Requirement | Pri |
|---|---|---|
| FR-8.1 | Every model call is logged with model, input and output token counts, cost, and latency. | M |
| FR-8.2 | Every tool run is logged with input, output, status, and duration. | M |
| FR-8.3 | Logs are stored so they can later serve as fine-tuning data. | S |

### 3.9 Proactive features (later)
| ID | Requirement | Pri |
|---|---|---|
| FR-9.1 | New mail triggers a Gmail push notification (Pub/Sub, `users.watch`, `history.list`). | L |
| FR-9.2 | A job queue (Redis + BullMQ) runs digests, triage, and follow-ups. | L |
| FR-9.3 | A cheap model classifies new mail and notifies the user of important items with a suggested action. | L |
| FR-9.4 | Additional channels (Telegram, then WhatsApp) are added as adapters. | L |

## 4. External Interface Requirements

### 4.1 REST and SSE API
| Endpoint | Purpose |
|---|---|
| `POST /api/messages` | Submit a user message |
| `GET /api/stream` | SSE stream of reply deltas, status, and approval events |
| `GET /api/history` | Load chat history |
| `POST /api/actions/:id/approve` | Approve a pending action |
| `POST /api/actions/:id/reject` | Reject a pending action |
| `GET /auth/google`, `GET /auth/google/callback` | Sign-in and Gmail OAuth |

### 4.2 External services
- **Anthropic Messages API** with tool use and streaming.
- **Gmail API** via `googleapis` (search, get, drafts, send, labels).
- **MongoDB** via Mongoose.

### 4.3 User interface
Single-page chat: message list, input box, streamed replies, approval cards with Approve and Reject buttons, and a layout that works at phone width.

## 5. Data Requirements

| Collection | Holds |
|---|---|
| `users` | Profile, settings, timezone |
| `integrations` | Encrypted OAuth tokens, Gmail state |
| `conversations` / `messages` | Chat history |
| `tool_runs` | Every tool call: input, output, status, duration |
| `pending_actions` | Actions awaiting approval, with expiry |
| `memory_docs` | Markdown notes by path |
| `usage` | Token counts and cost per model call |

## 6. Non-Functional Requirements

### 6.1 Security and privacy
| ID | Requirement |
|---|---|
| NFR-1 | Email content is untrusted. It is delimited in prompts and never treated as instructions (prompt-injection defense). |
| NFR-2 | Send, forward, and delete require a human click, enforced in code. |
| NFR-3 | Refresh tokens are encrypted at rest with AES-256-GCM. Secrets live in environment variables, never in the repo or in model context. |
| NFR-4 | Request only the minimum Gmail scopes needed at each stage. |
| NFR-5 | Session cookies are HTTP-only. CORS is restricted to the known client origin. |
| NFR-6 | Email content sent to the model is minimized through cleaning. |

### 6.2 Performance
| ID | Requirement |
|---|---|
| NFR-7 | First streamed token appears within about 3 seconds for a no-tool reply on a normal connection. |
| NFR-8 | Email cleaning reduces tokens on long threads by roughly 70 to 90%. |
| NFR-9 | The agent loop has an iteration cap and a per-request token budget to bound cost. |

### 6.3 Reliability
| ID | Requirement |
|---|---|
| NFR-10 | Gmail and Anthropic errors, rate limits, and token expiry are handled with retries and a clear user-facing message. |
| NFR-11 | A failed tool run never leaves a pending action in an ambiguous state. |

### 6.4 Maintainability and portability
| ID | Requirement |
|---|---|
| NFR-12 | The model layer is behind an interface so a local open-weight model can replace or supplement Claude. |
| NFR-13 | Channels are thin adapters over the agent core. |
| NFR-14 | One file per tool. Code layout: `api/`, `channels/`, `agent/`, `tools/`, `integrations/`, `services/`, `db/`. |

## 7. Acceptance Criteria by Milestone

| Step | Build | Done when |
|---|---|---|
| 1 | React chat, Express, MongoDB, Claude replies | The user can chat with it and history persists |
| 2 | System prompt | Behavior rules are written and applied |
| 3 | Google OAuth, encrypted token storage | Backend can access the user's inbox |
| 4 | `search_emails`, `read_thread`, agent loop | "What did Ahmed send me last week?" is answered correctly |
| 5 | `create_draft`, `send_email` with Approve button, verifier | A reply can be drafted, verified, approved, and sent, and no email is sent without a click |
| 6 | Preferences and contact memory | The agent applies the user's style and remembers contacts |
| 7 | Logging (throughout) | Every model and tool run is inspectable |

## 8. Risks

| Risk | Mitigation |
|---|---|
| Prompt injection through email content | Tagged untrusted content, code-enforced approvals, recipient checks, verifier |
| Hallucinated or wrong drafts | Verifier against the source thread, human approval before send |
| High inference cost | Email cleaning, Haiku for cheap tasks, token budgets, usage logging |
| 7-day refresh token expiry (External/Testing OAuth) | Use Workspace Internal type, or prompt for re-auth |
| Sensitive data sent to a third-party model | Review Anthropic terms, minimize content, keep the model layer swappable |
| WhatsApp policy and ToS limits | Use web and Telegram first. Unofficial WhatsApp only for private use |

## 9. Open Questions
- Is the Google account a Workspace account (Internal OAuth) or personal (External/Testing)?
- Should the verifier use Haiku or Sonnet?
- Where is the first deployment target after localhost (Railway, Render, AWS)?
