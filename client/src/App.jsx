import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";

function SignIn({ error }) {
  return (
    <div className="app center">
      <h1>Instinct</h1>
      <p>Your personal AI assistant. Sign in to connect your Gmail.</p>
      {error && <p className="error">Sign-in failed: {error}</p>}
      <a className="btn" href="/auth/google">Sign in with Google</a>
    </div>
  );
}

function Chat({ user, onLogout }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [gmail, setGmail] = useState(null);
  const [status, setStatus] = useState("");
  const bottomRef = useRef(null);

  useEffect(() => {
    fetch("/api/history").then((r) => r.json()).then(setMessages).catch(() => {});
    fetch("/api/gmail/status").then((r) => r.json()).then(setGmail).catch(() => {});

    const es = new EventSource("/api/stream");
    es.onmessage = (e) => {
      const event = JSON.parse(e.data);
      if (event.type === "status") {
        setStatus(event.message);
      } else if (event.type === "delta") {
        setStatus("");
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant" && last.streaming) {
            return [...prev.slice(0, -1), { ...last, text: last.text + event.text }];
          }
          return [...prev, { role: "assistant", text: event.text, streaming: true }];
        });
      } else if (event.type === "done") {
        setMessages((prev) => prev.map((m) => ({ ...m, streaming: false })));
        setStatus("");
        setBusy(false);
      } else if (event.type === "error") {
        setStatus("");
        setMessages((prev) => [...prev, { role: "assistant", text: `Error: ${event.message}` }]);
        setBusy(false);
      }
    };
    return () => es.close();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send(e) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);
    setMessages((prev) => [...prev, { role: "user", text }]);
    const res = await fetch("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) setBusy(false);
  }

  return (
    <div className="app">
      <header>
        <span>Instinct</span>
        <span className="meta">
          {gmail?.connected ? `Gmail: ${gmail.email}` : gmail ? <a href="/auth/google">Reconnect Gmail</a> : ""}
          {" · "}
          {user.email} · <button className="link" onClick={onLogout}>Sign out</button>
        </span>
      </header>
      <main>
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            <ReactMarkdown>{m.text}</ReactMarkdown>
          </div>
        ))}
        {(status || (busy && messages[messages.length - 1]?.role === "user")) && (
          <div className="status">{status || "Thinking..."}</div>
        )}
        <div ref={bottomRef} />
      </main>
      <form onSubmit={send}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Message Instinct..."
          autoFocus
        />
        <button disabled={busy || !input.trim()}>Send</button>
      </form>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = loading, null = signed out
  const authError = new URLSearchParams(window.location.search).get("auth_error");

  useEffect(() => {
    fetch("/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then(setUser)
      .catch(() => setUser(null));
    if (window.location.search) window.history.replaceState({}, "", "/");
  }, []);

  async function logout() {
    await fetch("/auth/logout", { method: "POST" });
    setUser(null);
  }

  if (user === undefined) return null;
  return user ? <Chat user={user} onLogout={logout} /> : <SignIn error={authError} />;
}
