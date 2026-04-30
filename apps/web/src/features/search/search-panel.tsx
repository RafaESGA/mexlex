"use client";

import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import type { InitiativeSearchResult } from "@mexlex/shared/domain/search";
import { searchInitiatives, type InitiativeFilters } from "../../lib/api/client";

type SearchPanelProps = {
  selectedInitiativeId?: string;
  onSelectInitiative: (initiative: { id: string; title: string }) => void;
};

const statusOptions = [
  ["", "Todos los estatus"],
  ["presented", "Presentada"],
  ["in_commissions", "En comisiones"],
  ["approved_origin", "Aprobada origen"],
  ["approved_reviser", "Aprobada revisora"],
  ["published_dof", "Publicada DOF"],
  ["archived", "Archivada"]
] as const;

const chamberOptions = [
  ["", "Todas las camaras"],
  ["diputados", "Diputados"],
  ["senado", "Senado"],
  ["congreso_union", "Congreso Union"],
  ["ejecutivo", "Ejecutivo"],
  ["otro", "Otro"]
] as const;

export function SearchPanel({ selectedInitiativeId, onSelectInitiative }: SearchPanelProps) {
  const [filters, setFilters] = useState<InitiativeFilters>({ status: "presented", limit: 50, offset: 0 });
  const [results, setResults] = useState<InitiativeSearchResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    runSearch(filters);
    // Load an initial, recent slice once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateFilter(key: keyof InitiativeFilters, value: string): void {
    setFilters((current) => ({ ...current, [key]: value, offset: 0 }));
  }

  function submitSearch(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    runSearch(filters);
  }

  function runSearch(nextFilters: InitiativeFilters): void {
    setError(null);
    setIsLoading(true);
    searchInitiatives(nextFilters)
      .then((response) => setResults(response.results))
      .catch((searchError: unknown) => {
        setError(searchError instanceof Error ? searchError.message : "No se pudo consultar la API");
      })
      .finally(() => setIsLoading(false));
  }

  return (
    <section className="panel search-card">
      <span className="eyebrow">Exploracion</span>
      <div>
        <h2>Busca por titulo, autor, comision o camara</h2>
        <p className="muted">
          Estos filtros ya consultan la API reconciliada. Empieza amplio y selecciona un resultado para abrir su
          timeline.
        </p>
      </div>

      <form className="filter-form" onSubmit={submitSearch}>
        <input
          aria-label="Buscar iniciativas"
          className="search-input"
          onChange={(event) => updateFilter("q", event.target.value)}
          placeholder="Ej. salud mental, Guardia Nacional, cambio climatico..."
          value={filters.q ?? ""}
        />
        <div className="filter-grid">
          <select
            aria-label="Estatus"
            className="search-input"
            onChange={(event) => updateFilter("status", event.target.value)}
            value={filters.status ?? ""}
          >
            {statusOptions.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select
            aria-label="Camara"
            className="search-input"
            onChange={(event) => updateFilter("chamber", event.target.value)}
            value={filters.chamber ?? ""}
          >
            {chamberOptions.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <input
            aria-label="Autor"
            className="search-input"
            onChange={(event) => updateFilter("author", event.target.value)}
            placeholder="Autor"
            value={filters.author ?? ""}
          />
          <input
            aria-label="Comision"
            className="search-input"
            onChange={(event) => updateFilter("commission", event.target.value)}
            placeholder="Comision"
            value={filters.commission ?? ""}
          />
        </div>
        <button className="primary-button" disabled={isLoading} type="submit">
          {isLoading ? "Consultando..." : "Buscar iniciativas"}
        </button>
      </form>

      {error ? <p className="notice warning">No pude consultar el API: {error}</p> : null}

      <div className="result-list">
        {results.length > 0 ? (
          <p className="muted result-count">
            Mostrando {results.length} resultado{results.length === 1 ? "" : "s"}.
          </p>
        ) : null}
        {results.length === 0 && !isLoading ? <p className="muted">No hay resultados con estos filtros.</p> : null}
        {results.map((result) => (
          <button
            className={`result-card ${selectedInitiativeId === result.id ? "is-selected" : ""}`}
            key={result.id}
            onClick={() => onSelectInitiative({ id: result.id, title: result.canonicalTitle })}
            type="button"
          >
            <span className="result-title">{result.canonicalTitle}</span>
            <span className="muted">
              {formatDate(result.presentedAt)} {result.matterTopic ? `· ${result.matterTopic}` : ""}
            </span>
            <span className="chip-row">
              <span className="chip">{result.normalizedStatus}</span>
              {result.score ? <span className="chip">score {result.score.toFixed(2)}</span> : null}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function formatDate(date: string | null | undefined): string {
  if (!date) {
    return "Sin fecha";
  }

  return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" }).format(new Date(date));
}
