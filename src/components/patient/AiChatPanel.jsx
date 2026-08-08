import { useEffect, useRef, useState } from "react";
import { ChevronDown, Send, Sparkles } from "lucide-react";
import {
  AI_CHAT_DISCLAIMER,
  AI_CHAT_GREETING,
  AI_CHAT_REPLIES
} from "../../constants/content.js";
import { cx } from "../../lib/cx.js";

function pickReply(mood) {
  const pool = AI_CHAT_REPLIES[mood] ?? AI_CHAT_REPLIES.default;
  return pool[Math.floor(Math.random() * pool.length)];
}

export function AiChatPanel({ patient }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState([
    { id: "greeting", author: "ai", text: AI_CHAT_GREETING }
  ]);
  const [thinking, setThinking] = useState(false);
  const listRef = useRef(null);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, thinking, open]);

  function sendMessage(event) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || thinking) return;
    const userMsg = { id: `u-${Date.now()}`, author: "user", text };
    setMessages((prev) => [...prev, userMsg]);
    setDraft("");
    setThinking(true);
    const reply = pickReply(patient?.mood);
    const delay = 700 + Math.floor(Math.random() * 600);
    window.setTimeout(() => {
      setMessages((prev) => [...prev, { id: `a-${Date.now()}`, author: "ai", text: reply }]);
      setThinking(false);
    }, delay);
  }

  return (
    <div className={cx("panel", "ai-chat-panel", open && "ai-chat-panel--open")}>
      <button
        type="button"
        className="ai-chat-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="ai-chat-body"
      >
        <span className="ai-chat-toggle-title">
          <Sparkles size={18} aria-hidden="true" />
          <span>Charlemos un ratito</span>
        </span>
        <ChevronDown
          size={20}
          aria-hidden="true"
          className={cx("ai-chat-chevron", open && "ai-chat-chevron--open")}
        />
      </button>
      {open && (
        <div id="ai-chat-body" className="ai-chat-body">
          <p className="ai-chat-disclaimer" role="note">{AI_CHAT_DISCLAIMER}</p>
          <div
            ref={listRef}
            className="ai-chat-messages"
            role="log"
            aria-live="polite"
            aria-label="Conversación con el compañero del jardín"
          >
            {messages.map((msg) => (
              <div key={msg.id} className={cx("ai-bubble", `ai-bubble--${msg.author}`)}>
                {msg.text}
              </div>
            ))}
            {thinking && (
              <div className="ai-bubble ai-bubble--ai ai-bubble--typing" aria-label="Escribiendo">
                <span className="ai-dot" />
                <span className="ai-dot" />
                <span className="ai-dot" />
              </div>
            )}
          </div>
          <form className="ai-chat-form" onSubmit={sendMessage}>
            <label htmlFor="ai-chat-input" className="sr-only">Escribí tu mensaje</label>
            <input
              id="ai-chat-input"
              type="text"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Contame cómo va tu día..."
              autoComplete="off"
            />
            <button type="submit" className="ai-chat-send" disabled={!draft.trim() || thinking} aria-label="Enviar mensaje">
              <Send size={18} aria-hidden="true" />
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
