"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { sendAiChat, type AiChatHistoryMessage } from "../../lib/api/client";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolSummary?: string;
};

const starterPrompts = [
  "Busca iniciativas de Saúl Monreal sobre protección de datos personales",
  "Qué tan limpia está la base legislativa?",
  "Dame el timeline de la iniciativa más reciente sobre salud mental"
];

export function LegislativeChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "Soy el copiloto legislativo de MexLex. Puedo buscar iniciativas, revisar autores, abrir timelines y explicar la calidad de la base usando nuestra API."
    }
  ]);
  const [draft, setDraft] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    sendMessage(draft);
  }

  function sendMessage(rawMessage: string): void {
    const message = rawMessage.trim();
    if (!message || isLoading) {
      return;
    }

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: message
    };

    setMessages((current) => [...current, userMessage]);
    setDraft("");
    setIsLoading(true);

    sendAiChat(message, toChatHistory(messages))
      .then((response) => {
        setMessages((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: response.answer,
            toolSummary:
              response.toolCalls.length > 0
                ? `Herramientas: ${response.toolCalls.map((call) => call.name).join(", ")}`
                : undefined
          }
        ]);
      })
      .catch((error: unknown) => {
        setMessages((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content:
              error instanceof Error
                ? `No pude completar la consulta: ${error.message}`
                : "No pude completar la consulta."
          }
        ]);
      })
      .finally(() => setIsLoading(false));
  }

  return (
    <section className="panel chat-panel">
      <div>
        <span className="eyebrow">AI Legislativa</span>
        <h2>Pregunta como si hablaras con un analista</h2>
        <p className="muted">
          La IA puede llamar herramientas internas para buscar iniciativas, consultar detalles, revisar timelines y
          citar fuentes.
        </p>
      </div>

      <div className="starter-row">
        {starterPrompts.map((prompt) => (
          <button className="starter-chip" key={prompt} onClick={() => sendMessage(prompt)} type="button">
            {prompt}
          </button>
        ))}
      </div>

      <div className="chat-thread">
        {messages.map((message) => (
          <article className={`chat-message ${message.role}`} key={message.id}>
            <div className="chat-bubble">
              <p>{message.content}</p>
              {message.toolSummary ? <span>{message.toolSummary}</span> : null}
            </div>
          </article>
        ))}
        {isLoading ? (
          <article className="chat-message assistant">
            <div className="chat-bubble">
              <p>Consultando herramientas legislativas...</p>
            </div>
          </article>
        ) : null}
      </div>

      <form className="chat-form" onSubmit={submit}>
        <textarea
          aria-label="Mensaje para la IA legislativa"
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Ej. Encuentra iniciativas de Saúl Monreal sobre protección de datos personales..."
          value={draft}
        />
        <button className="primary-button" disabled={isLoading} type="submit">
          Enviar
        </button>
      </form>
    </section>
  );
}

function toChatHistory(messages: ChatMessage[]): AiChatHistoryMessage[] {
  return messages
    .filter((message) => message.id !== "welcome")
    .map((message) => ({
      role: message.role,
      content: message.content
    }))
    .slice(-10);
}
