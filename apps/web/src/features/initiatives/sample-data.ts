import type { InitiativeSearchResult } from "@mexlex/shared/domain/search";
import type { LegislativeEvent } from "@mexlex/shared/domain/timeline";

export const sampleSearchResults: InitiativeSearchResult[] = [
  {
    id: "demo-initiative",
    canonicalTitle: "Proyecto de ejemplo para inteligencia legislativa",
    normalizedStatus: "in_commissions",
    score: 0.91,
    matchedOn: ["keyword", "semantic"],
    snippet: "Iniciativa reconciliada entre SIL, Gaceta Parlamentaria y Senado.",
    aliases: ["Proyecto de decreto en materia de datos legislativos"]
  }
];

export const sampleTimeline: LegislativeEvent[] = [
  {
    id: "evt-1",
    eventType: "presentation",
    eventDate: "2025-09-03T10:00:00.000Z",
    title: "Presentacion de la iniciativa",
    description: "Se presenta ante la camara de origen.",
    chamber: "diputados"
  },
  {
    id: "evt-2",
    eventType: "gaceta_publication",
    eventDate: "2025-09-04T08:00:00.000Z",
    title: "Publicacion en gaceta",
    description: "Entrada rastreable en gaceta con URL de evidencia.",
    chamber: "diputados"
  },
  {
    id: "evt-3",
    eventType: "turn_to_commission",
    eventDate: "2025-09-05T15:30:00.000Z",
    title: "Turnada a comisiones",
    description: "Se registra turnado a comisiones dictaminadoras.",
    chamber: "diputados"
  }
];

