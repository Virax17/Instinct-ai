import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";

export default function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    fetch("/api/history")
      .then((r) => r.json())
      .then(setMessages)
      .catch(() => {});

    const es = new EventSource("/api/stream");
    es.onmessage = (e) => {
      const event = JSON.parse(e.data);
      if (event.type === "delta") {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant" && last.streaming) {
            return [...prev.slice(0, -1), { ...last, text: last.text + event.text }];
          }
          return [...prev, { role: "assistant", text: event.text, streaming: true }];
        });
      } else if (event.type === "done") {
        setMessages((prev) => prev.map((m) => ({ ...m, streaming: false })));
        setBusy(false);
      } else if (event.type === "error") {
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
      <header>Instinct</header>
      <main>
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            <ReactMarkdown>{m.text}</ReactMarkdown>
          </div>
        ))}
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
