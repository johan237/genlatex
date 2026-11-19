# Chat Functionality Review — Issues and Fixes

Review of the editor AI chat: flow, gaps, and what's been fixed.

---

## 1. Flow (current)

1. **ChatPopup** (`components/ChatPopup.js`) is the single chat UI. In the editor, it delegates to **handleChatSend** in `app/editor/[projectId]/page.js`, which sends `POST /api/ai/chat` with:
   - `message`, `projectId`, `currentDocument`, `mode`, `mentionedFiles`, `stream: true`
   - `context`: `activeFile`, `highlighted_files`, `selection`, `cursor_position`, `selectedText`, `current_document`
2. **Next.js** `app/api/ai/chat/route.js`:
   - Optionally loads conversation history from DB via `getChatHistoryForContext(projectId)` and `getConversationHistory(dbMessages)`.
   - Builds `chatRequest` with `message`, `project_id`, `project_path`, `mode`, `context` (active_file, selection, cursor_position, current_document, mentioned_files, highlighted_files, conversation_history), `stream`.
   - Forwards to Python `POST ${GENLATEX_AGENT_URL}/api/chat` with that body.
3. **Python** `genlatex-agent/api/main.py` `/api/chat`:
   - Uses `ChatRequest` (message, project_id, mode, context, stream).
   - Requires auth when `AGENT_API_TOKEN` is set; Next.js sends `Authorization` when `GENLATEX_AGENT_API_KEY` or `AGENT_API_TOKEN` is configured.
   - Builds `request_dict` from `ChatRequest`, calls `orchestrator.process(request_dict)` or `process_stream`.
4. **Orchestrator** (`core/orchestrator.py`) uses `request.get("project_path")` and receives it from the backend.

---

## 2. Issues and status

### 2.1 Auth not forwarded (fixed)

- **Issue:** When `AGENT_API_TOKEN` (or `GENLATEX_AGENT_API_KEY`) is set, `/api/chat` returns 401. The Next.js AI chat route does not send `Authorization: Bearer <token>` to the Python backend.
- **Fix:** In `app/api/ai/chat/route.js`, when calling the Python backend, set the `Authorization` header using `GENLATEX_AGENT_API_KEY` or `AGENT_API_TOKEN`, same pattern as `generate-with-project`.

### 2.2 `project_path` dropped (fixed)

- **Issue:** Next.js sends `project_path` in the body. `ChatRequest` has no `project_path` field, so Pydantic drops it.
- **Fix:** Add `project_path: Optional[str] = None` to `ChatRequest`. In the `/api/chat` handler, set `request_dict["project_path"]` so the orchestrator receives the path.

### 2.3 "New Chat" only clears UI

- **Issue:** "New Chat" clears local `messages` only. The AI route still calls `getChatHistoryForContext(projectId)` and sends full DB history to the model.
- **Fix (optional):** Support something like `clearContext: true` so the route skips DB history for that request, or add an explicit "Clear history" that deletes messages in the DB.

### 2.4 `active_file` can be wrong (fixed)

- **Issue:** Backend always got `main.tex` when there was content, even if the user was editing e.g. `section.tex`.
- **Fix:** The editor passes `currentFile` into ChatPopup, and handleChatSend sends `activeFile` in the context so the backend gets the real active file.

### 2.5 Chat history when not logged in

- **Issue:** The AI route uses `getSessionFromRequest()` (Better Auth) and only then calls `getChatHistoryForContext(projectId)`. If the session is missing or invalid, history is not loaded.
- **Fix (optional):** Decide whether unauthenticated users are allowed to use chat; if not, return 401/403 early.

### 2.6 `chat_messages` table missing

- **Issue:** `getChatMessages` / `saveChatMessage` / `getChatHistoryForContext` assume a `chat_messages` table.
- **Fix:** Run `lib/db-migrations/create-chat-messages.sql`. Ensure deploy/docs mention this migration.

### 2.7 Next.js 15 `params`

- **Issue:** In Next.js 15, `params` in page components can be a Promise.
- **Fix (if on Next 15):** Use `const { projectId } = await params` in the editor page.

---

## 3. What was fixed in code

1. **Auth:** `app/api/ai/chat/route.js` now sends `Authorization: Bearer ${GENLATEX_AGENT_API_KEY || AGENT_API_TOKEN}` when that env is set.
2. **project_path:** `ChatRequest` has `project_path`; the handler includes it in `request_dict`.
3. **Active file:** handleChatSend sends `context.activeFile` (current file name).
4. **Cursor position:** handleChatSend sends `context.cursor_position` for insert-at-cursor functionality.
5. **Highlighted files:** handleChatSend sends `context.highlighted_files` (from mentionedFiles); selection context menu passes chatContextFiles.

---

## 4. Context feature: what AI chat uses

- **Conversation history + document context:** The AI chat route uses `getChatHistoryForContext(projectId)` and `getConversationHistory(dbMessages)` and sends `conversation_history`, `current_document`, `active_file`, `selection`, `cursor_position`, `highlighted_files`, `project_path` to the Python backend.
- **Context-mapper / question-router:** Those live in `context-mapper.js` and `question-router.js` and are used by `file-modifier.js` and `aimodel-client.js`. The ChatPopup → handleChatSend → `/api/ai/chat` → Python path does **not** call them. The Python backend does its own intent handling.

## 5. Data on page load

- **Reload when projectId changes:** ChatPopup loads history from the editor's external messages; handleChatSend uses DB history via the API route.
- **Persistence:** Messages are saved to `/api/chat/${projectId}/messages` by handleChatSend. The DB is the source of truth for conversation context.

## 6. Quick checklist for you

- [ ] Run `create-chat-messages.sql` if you use persistent chat.
- [ ] Set `GENLATEX_AGENT_API_KEY` or `AGENT_API_TOKEN` on the backend when you want auth; set the same value in Next.js env so the AI chat route can send it.
- [ ] If "New Chat" should start a new conversation for the model, implement one of the options in §2.3.
- [ ] If you use Next.js 15, adjust editor (and any other) page to await `params` (§2.7).
