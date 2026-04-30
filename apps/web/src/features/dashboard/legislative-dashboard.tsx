"use client";

import { useState } from "react";
import { LegislativeChat } from "../chat/legislative-chat";
import { SearchPanel } from "../search/search-panel";
import { TimelinePanel } from "../timeline/timeline-panel";

type SelectedInitiative = {
  id: string;
  title: string;
};

export function LegislativeDashboard() {
  const [selectedInitiative, setSelectedInitiative] = useState<SelectedInitiative | null>(null);

  return (
    <main className="page-shell">
      <div className="page-frame">
        <section className="hero hero-grid">
          <div>
            <span className="eyebrow">MexLex Dataset</span>
            <h1>Explorador legislativo con evidencia, autores y timeline.</h1>
          </div>
          <p>
            Consulta la base reconciliada de iniciativas federales, filtra por fuente legislativa y abre la
            cronologia de cada expediente para revisar la trazabilidad antes de construir analisis o respuestas con AI.
          </p>
        </section>

        <LegislativeChat />

        <section className="content-grid">
          <SearchPanel onSelectInitiative={setSelectedInitiative} selectedInitiativeId={selectedInitiative?.id} />
          <TimelinePanel initiativeId={selectedInitiative?.id} initiativeTitle={selectedInitiative?.title} />
        </section>
      </div>
    </main>
  );
}
