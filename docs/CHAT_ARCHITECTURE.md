# Chat System Architecture

> **Note (2026-03-11):** The chat UI pages and API routes have been removed as the application pivots to DappaAi AI (AlayaCare caregiver shift-filling). The underlying LLM client (`src/lib/llm/`), chat services, and database schema tables still exist and will be repurposed for PoC 2 (LLM-powered caregiver matching and escalation reasoning). This document is retained as reference for the Bedrock integration pattern.

## Overview

The chat system provides a conversational AI interface powered by **Claude Haiku 4.5** on **AWS Bedrock**. It supports multiple conversations with persistent message history, real-time token streaming via Server-Sent Events (SSE), and optimistic UI updates.

## System Diagram

```
┌─────────────────────────────────────────────────────────────┐
│  Client (React)                                             │
│                                                             │
│  ┌──────────────┐   ┌──────────────┐   ┌────────────────┐  │
│  │  ChatPanel    │──▶│  useStreamChat│──▶│  apiFetch()    │  │
│  │  ChatMessage  │   │  useMessages  │   │  (SSE stream)  │  │
│  │  ChatInput    │   │  useConvos    │   └───────┬────────┘  │
│  └──────────────┘   └──────────────┘            │            │
│         ▲                    ▲                   │            │
│         │  optimistic updates│                   │            │
│         └────────────────────┘                   │            │
└──────────────────────────────────────────────────┼────────────┘
                                                   │
                                                   ▼
┌─────────────────────────────────────────────────────────────┐
│  Next.js API Routes                                         │
│                                                             │
│  POST /api/chat/stream        ──▶ requireAuthContext + SSE   │
│  GET  /api/chat/conversations ──▶ requireAuthContext + UoW   │
│  POST /api/chat/conversations ──▶ requireAuthContext + UoW   │
│  GET  /api/chat/conversations/[id]     ──▶ requireAuthContext│
│  DELETE /api/chat/conversations/[id]   ──▶ requireAuthContext│
│  GET  /api/chat/conversations/[id]/messages ──▶ reqAuthCtx   │
└───────────────────────────┬─────────────────────────────────┘
                            │
              ┌─────────────┼─────────────┐
              ▼                           ▼
┌──────────────────────┐    ┌──────────────────────┐
│  chat-service.ts     │    │  bedrock-client.ts   │
│  (Drizzle ORM)       │    │  (ConverseStream)    │
│                      │    │                      │
│  - listConversations │    │  - streamChat()      │
│  - createConversation│    │  - generateText()    │
│  - getMessages       │    │                      │
│  - createMessage     │    │  Model: Haiku 4.5    │
│  - deleteConversation│    │  Region: ap-se-2     │
│  - updateConvTitle   │    │                      │
└──────────┬───────────┘    └──────────────────────┘
           │
           ▼
┌──────────────────────┐
│  Supabase PostgreSQL │
│                      │
│  chatConversations   │
│  chatMessages        │
│  (RLS enforced)      │
└──────────────────────┘
```

## Database Schema

### `chatConversations`

| Column    | Type        | Notes                          |
|-----------|-------------|--------------------------------|
| id        | uuid (PK)   | Default: `gen_random_uuid()`   |
| userId    | uuid (FK)   | References `users.id`          |
| title     | text        | Nullable, auto-set from first message |
| createdAt | timestamptz | Default: `now()`               |
| updatedAt | timestamptz | Default: `now()`               |

### `chatMessages`

| Column         | Type        | Notes                          |
|----------------|-------------|--------------------------------|
| id             | uuid (PK)   | Default: `gen_random_uuid()`   |
| conversationId | uuid (FK)   | References `chatConversations.id` (CASCADE) |
| userId         | uuid (FK)   | References `users.id`          |
| role           | text        | `"user"` or `"assistant"`      |
| content        | text        | Message body                   |
| createdAt      | timestamptz | Default: `now()`               |

Both tables are protected by Row-Level Security (RLS) policies using `auth.uid()`, set per-transaction by the UoW layer via `request.jwt.claims`.

## API Routes

### `POST /api/chat/stream`

The main chat endpoint. Accepts a message, streams the AI response via SSE.

**Request body:**
```json
{ "conversationId": "uuid", "message": "string (1-10000 chars)" }
```

**SSE event types:**
| Event   | Payload                        | Description                     |
|---------|--------------------------------|---------------------------------|
| `start` | `{}`                           | Stream has begun                |
| `chunk` | `{ text: "token" }`           | Individual token from LLM       |
| `done`  | `{ usage: { inputTokens, outputTokens } }` | Stream complete   |
| `error` | `{ message: "error text" }`   | Error occurred                  |
| `[DONE]`| Raw string (not JSON)          | Terminal signal                  |

**Processing flow:**
1. Authenticate via `requireAuthContext(req, traceId)` (cookie or Bearer token)
2. Create deps via `makeDeps()`
3. **Command 1 (UoW):** Validate request body (via `SaveUserMessageInput` Zod schema), verify conversation ownership, save user message to DB, auto-rename conversation if still default title, load last 40 messages for LLM context — all within a single UoW transaction that commits before streaming begins
4. Return SSE Response via `createSSEResponse()` helper (`src/lib/sse.ts`) — command 1's transaction is committed
5. Stream tokens from Bedrock to client via SSE chunks
6. **Command 2 (UoW):** Save assistant response (validated via `SaveAssistantMessageInput` Zod schema) in a **separate UoW transaction** after streaming completes
7. Send `done` event with usage stats; errors are logged with `traceId`

> **D4 Exception**: The chat stream route is exempt from the standard single-handler-per-route pattern. It orchestrates **2 separate UoW commands** (`handleSaveUserMessage` and `handleSaveAssistantMessage`) across the SSE boundary, because the first transaction must commit before the Response is returned, while the assistant message can only be saved after streaming finishes.

### `GET /api/chat/conversations`

Returns all conversations for the authenticated user, ordered by most recently updated.

### `POST /api/chat/conversations`

Creates a new conversation. Optional `title` in body (validated via `CreateConversationInput` Zod schema — trimmed, 1-200 chars); defaults to `DEFAULT_CONVERSATION_TITLE` (`"New conversation"`).

### `GET /api/chat/conversations/[id]`

Returns a single conversation (with ownership check).

### `DELETE /api/chat/conversations/[id]`

Deletes a conversation. Messages are cascade-deleted.

### `GET /api/chat/conversations/[id]/messages`

Returns all messages for a conversation, ordered chronologically.

## LLM Integration

### Bedrock Client (`src/lib/llm/bedrock-client.ts`)

Two functions:

- **`streamChat(options)`** - Streaming via `ConverseStreamCommand`. Calls `onToken` callback for each text delta. Returns `{ fullText, usage }`.
- **`generateText(options)`** - Non-streaming via `ConverseCommand`. Returns `{ text, usage }`.

### Configuration (`src/lib/llm/types.ts`)

| Setting       | Value                                          |
|---------------|------------------------------------------------|
| Model         | `au.anthropic.claude-haiku-4-5-20251001-v1:0`  |
| Region        | `ap-southeast-2` (AU inference profile)        |
| Max tokens    | 4096                                           |
| Temperature   | 0.7                                            |

### System Prompt

```
You are a helpful AI assistant powered by Claude Haiku. Be concise, friendly, and accurate.
If you don't know something, say so rather than making things up.
Do not claim to be a different model than Claude Haiku.
```

## Conversation Memory

The system uses **server-side conversation memory**:

1. All messages (user + assistant) are persisted to `chatMessages` in the database
2. On each new message, the API loads the **last 40 messages** from the database
3. These are sent to the LLM as conversation history, providing context
4. The client does **not** send conversation history — it's loaded server-side

This means the LLM always has access to recent conversation context without relying on the client to pass it.

## Client-Side Architecture

### React Hooks (`src/hooks/use-chat.ts`)

| Hook                      | Purpose                                    |
|---------------------------|--------------------------------------------|
| `useConversations()`      | Fetch all conversations (TanStack Query)   |
| `useConversation(id)`     | Fetch single conversation                  |
| `useMessages(convId)`     | Fetch messages for a conversation          |
| `useCreateConversation()` | Create mutation with cache invalidation    |
| `useDeleteConversation()` | Delete mutation with optimistic rollback   |
| `useStreamChat()`         | SSE streaming with optimistic updates      |

### `useStreamChat()` — Optimistic Update Flow

```
1. User types message and hits Send
   │
2. ├─▶ Add user message to cache immediately (temp ID)
   │    User sees their message appear instantly
   │
3. ├─▶ Add empty assistant message to cache (temp ID)
   │    Placeholder for streaming content
   │
4. ├─▶ POST /api/chat/stream
   │
5. ├─▶ As SSE "chunk" events arrive:
   │    Update assistant message content in cache
   │    User sees tokens appear in real-time
   │
6. ├─▶ On stream complete:
   │    invalidateQueries(["messages", convId])
   │    Refetch from server to get real IDs
   │
7. └─▶ On error:
       Remove both optimistic messages from cache
```

### UI Components

| Component    | File                             | Role                              |
|-------------|----------------------------------|-----------------------------------|
| `ChatPanel` | `components/chat/chat-panel.tsx` | Main container: sidebar + chat area |
| `ChatMessage`| `components/chat/chat-message.tsx`| Single message with avatar/styling |
| `ChatInput` | `components/chat/chat-input.tsx` | Auto-expanding textarea + send    |

**ChatPanel layout:**
```
┌────────────┬───────────────────────────────┐
│            │                               │
│  Sidebar   │     Message Area              │
│            │     (ScrollArea)              │
│  [New Chat]│                               │
│            │     ┌─────────────────────┐   │
│  Conv 1  ✕ │     │ User: Hello         │   │
│  Conv 2  ✕ │     │ Assistant: Hi!      │   │
│  Conv 3  ✕ │     │ User: ...           │   │
│            │     └─────────────────────┘   │
│            │                               │
│            │  ┌─────────────────────────┐  │
│            │  │ Type a message... [Send] │  │
│            │  └─────────────────────────┘  │
└────────────┴───────────────────────────────┘
```

**Key behaviors:**
- First user message auto-renames conversation from default title (title = first 100 chars of message, handled in `save-user-message.ts` handler)
- Enter sends, Shift+Enter adds newline
- Cancel button appears during streaming
- Auto-scrolls to bottom on new messages
- Conversation delete with hover-reveal button

## Security

- All API routes use `requireAuthContext(req)` which:
  - Verifies JWT (cookie or Bearer token)
  - Gets/creates DB user
  - Checks account status (suspended/deleted)
  - Returns an `AuthContext` (no transaction — auth runs outside UoW)
- Handlers receive `deps` (from `makeDeps()`) and run business logic inside a UoW transaction that sets `request.jwt.claims` for RLS
- All DB queries scoped to authenticated user via RLS
- Conversation ownership verified before operations
- Message content validated (1-10,000 chars) via zod

## File Map

```
app/
├── (app)/chat/page.tsx                          # Chat page wrapper
├── api/chat/
│   ├── stream/route.ts                          # SSE streaming endpoint
│   └── conversations/
│       ├── route.ts                             # List/create conversations
│       └── [id]/
│           ├── route.ts                         # Get/delete conversation
│           └── messages/route.ts                # Get messages

components/chat/
├── chat-panel.tsx                               # Main chat UI
├── chat-message.tsx                             # Message display
└── chat-input.tsx                               # Input with streaming support

src/
├── hooks/use-chat.ts                            # TanStack Query hooks + streaming
├── services/chat-service.ts                     # DB operations (Drizzle) + DEFAULT_CONVERSATION_TITLE
├── server/commands/chat/
│   ├── save-user-message.ts                     # Validates input, saves message, auto-renames conversation
│   ├── save-assistant-message.ts                # Validates input, saves assistant response
│   └── create-conversation.ts                   # Validates input, creates conversation
├── lib/sse.ts                                   # createSSEResponse() helper
├── lib/llm/
│   ├── bedrock-client.ts                        # AWS Bedrock integration
│   └── types.ts                                 # LLM types + config
└── db/schema.ts                                 # chatConversations + chatMessages tables
```
