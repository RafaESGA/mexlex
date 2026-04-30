"use client";

import { useEffect, useState } from "react";
import type { LegislativeEvent } from "@mexlex/shared/domain/timeline";
import { getLegislativeTimeline, getReconciliationScorecard, type ReconciliationScorecard } from "../../lib/api/client";

type TimelinePanelProps = {
  initiativeId?: string;
  initiativeTitle?: string;
};

export function TimelinePanel({ initiativeId, initiativeTitle }: TimelinePanelProps) {
  const [events, setEvents] = useState<LegislativeEvent[]>([]);
  const [scorecard, setScorecard] = useState<ReconciliationScorecard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    setError(null);
    setIsLoading(true);
    const request = initiativeId
      ? getLegislativeTimeline(initiativeId).then((response) => setEvents(response.events))
      : getReconciliationScorecard().then((response) => setScorecard(response));

    request
      .catch((timelineError: unknown) => {
        setError(timelineError instanceof Error ? timelineError.message : "No se pudo consultar la API");
      })
      .finally(() => setIsLoading(false));
  }, [initiativeId]);

  return (
    <section className="panel">
      <span className="eyebrow">{initiativeId ? "Trazabilidad" : "Calidad"}</span>
      <h2>{initiativeId ? "Linea de tiempo legislativa" : "Scorecard del dataset"}</h2>
      {initiativeTitle ? <p className="muted">{initiativeTitle}</p> : null}
      {isLoading ? <p className="notice">Consultando API...</p> : null}
      {error ? <p className="notice warning">No pude consultar el API: {error}</p> : null}

      {initiativeId ? <Timeline events={events} /> : <Scorecard scorecard={scorecard} />}
    </section>
  );
}

function Timeline({ events }: { events: LegislativeEvent[] }) {
  if (events.length === 0) {
    return <p className="muted">Selecciona una iniciativa con eventos para revisar su cronologia.</p>;
  }

  return (
    <div className="timeline">
      {events.map((event) => (
        <article key={event.id} className="timeline-item">
          <strong>{event.title ?? event.eventType}</strong>
          <p className="muted">
            {formatDate(event.eventDate)} · {event.eventType}
            {event.chamber ? ` · ${event.chamber}` : ""}
          </p>
          {event.description ? <p>{event.description}</p> : null}
        </article>
      ))}
    </div>
  );
}

function Scorecard({ scorecard }: { scorecard: ReconciliationScorecard | null }) {
  if (!scorecard) {
    return <p className="muted">Cargando resumen de calidad...</p>;
  }

  return (
    <div className="scorecard">
      <div className={`scorecard-status status-${scorecard.status}`}>{scorecard.status}</div>
      <div className="metric-grid">
        <Metric label="Iniciativas" value={scorecard.summary.initiatives} />
        <Metric label="Autores" value={scorecard.summary.authors} />
        <Metric label="Fuentes" value={scorecard.summary.sourceLinks} />
        <Metric label="Eventos" value={scorecard.summary.eventRows} />
      </div>
      <div className="timeline">
        {scorecard.checks.map((check) => (
          <article key={check.key} className="timeline-item">
            <strong>{check.label}</strong>
            <p className="muted">
              {check.status} · {check.count} detectados
            </p>
          </article>
        ))}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric">
      <strong>{new Intl.NumberFormat("es-MX").format(value)}</strong>
      <span>{label}</span>
    </div>
  );
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" }).format(new Date(date));
}
