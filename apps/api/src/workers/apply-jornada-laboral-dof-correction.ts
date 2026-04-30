import { createHash } from "node:crypto";
import { supabaseAdmin } from "../db/supabase.js";

const initiativeId = "270c7421-39fd-4983-9ed1-740f9968b7e2";
const approvalEventId = "0898747f-524b-4b03-871f-0a7c3c0898b5";
const dofDate = "2026-03-03T00:00:00.000Z";
const dofUrl = "https://dof.gob.mx/nota_detalle.php?codigo=5781417&fecha=03/03/2026";
const sourceKey = "manual:dof:5781417:2026-03-03";
const dofTitle =
  "DECRETO por el que se reforman las fracciones IV y XI del Apartado A del Articulo 123 de la Constitucion Politica de los Estados Unidos Mexicanos, en materia de reduccion de la jornada laboral.";

async function main(): Promise<void> {
  const manualSource = await supabaseAdmin.from("sources").select("id").eq("system", "manual").single();
  if (manualSource.error) {
    throw manualSource.error;
  }

  const sourceRecordId = await upsertDofSourceRecord(manualSource.data.id);
  await normalizeApprovalEvent();
  const dofEventId = await upsertDofPublicationEvent();
  await linkDofSourceToEvent(dofEventId, sourceRecordId);
  await linkDofSourceToInitiative(sourceRecordId);
  const initiative = await markInitiativeAsPublished();

  console.log(
    JSON.stringify(
      {
        initiative,
        dofEventId,
        sourceRecordId
      },
      null,
      2
    )
  );
}

async function upsertDofSourceRecord(sourceId: string): Promise<string> {
  const existing = await supabaseAdmin
    .from("source_records")
    .select("id")
    .eq("source_id", sourceId)
    .eq("source_record_key", sourceKey)
    .maybeSingle();

  if (existing.error) {
    throw existing.error;
  }

  if (existing.data) {
    return existing.data.id;
  }

  const inserted = await supabaseAdmin
    .from("source_records")
    .insert({
      source_id: sourceId,
      record_type: "dof_publication",
      source_record_key: sourceKey,
      source_url: dofUrl,
      content_hash: sha256(`${sourceKey}|${dofTitle}`),
      raw_payload: {
        source: "dof",
        official_url: dofUrl,
        verified_at: new Date().toISOString()
      },
      parsed_payload: {
        title: dofTitle,
        published_at: "2026-03-03",
        normalized_status: "published_dof"
      },
      status: "parsed"
    })
    .select("id")
    .single();

  if (inserted.error) {
    throw inserted.error;
  }

  return inserted.data.id;
}

async function normalizeApprovalEvent(): Promise<void> {
  const updated = await supabaseAdmin
    .from("legislative_events")
    .update({
      event_type: "approved_origin",
      title: "Aprobacion legislativa",
      normalized_status_after: "approved_origin",
      metadata: {
        source: "senado_transparencia",
        correction: "normalized_from_raw_status_aprobada"
      }
    })
    .eq("id", approvalEventId);

  if (updated.error) {
    throw updated.error;
  }
}

async function upsertDofPublicationEvent(): Promise<string> {
  const existing = await supabaseAdmin
    .from("legislative_events")
    .select("id")
    .eq("initiative_id", initiativeId)
    .eq("event_type", "dof_publication")
    .eq("event_date", dofDate)
    .eq("title", "Publicacion en DOF")
    .maybeSingle();

  if (existing.error) {
    throw existing.error;
  }

  const payload = {
    description: dofTitle,
    chamber: "ejecutivo",
    normalized_status_after: "published_dof",
    event_hash: sha256(`${initiativeId}|dof_publication|${dofDate}|Publicacion en DOF`),
    metadata: {
      source: "manual_dof_verification",
      official_url: dofUrl,
      dof_codigo: "5781417"
    }
  };

  if (existing.data) {
    const updated = await supabaseAdmin.from("legislative_events").update(payload).eq("id", existing.data.id);
    if (updated.error) {
      throw updated.error;
    }

    return existing.data.id;
  }

  const inserted = await supabaseAdmin
    .from("legislative_events")
    .insert({
      initiative_id: initiativeId,
      event_type: "dof_publication",
      event_date: dofDate,
      title: "Publicacion en DOF",
      ...payload
    })
    .select("id")
    .single();

  if (inserted.error) {
    throw inserted.error;
  }

  return inserted.data.id;
}

async function linkDofSourceToEvent(eventId: string, sourceRecordId: string): Promise<void> {
  const linked = await supabaseAdmin.from("event_source_links").upsert(
    {
      legislative_event_id: eventId,
      source_record_id: sourceRecordId
    },
    {
      onConflict: "legislative_event_id,source_record_id"
    }
  );

  if (linked.error) {
    throw linked.error;
  }
}

async function linkDofSourceToInitiative(sourceRecordId: string): Promise<void> {
  const linked = await supabaseAdmin.from("initiative_source_links").upsert(
    {
      initiative_id: initiativeId,
      source_record_id: sourceRecordId,
      source_native_id: sourceKey,
      source_title: dofTitle,
      source_status: "Publicado en DOF",
      confidence: 0.99,
      is_primary: false
    },
    {
      onConflict: "initiative_id,source_record_id"
    }
  );

  if (linked.error) {
    throw linked.error;
  }
}

async function markInitiativeAsPublished(): Promise<unknown> {
  const updated = await supabaseAdmin
    .from("initiatives")
    .update({
      normalized_status: "published_dof",
      raw_status: "Publicada en DOF",
      last_major_event_at: dofDate
    })
    .eq("id", initiativeId)
    .select("id, normalized_status, raw_status, last_major_event_at")
    .single();

  if (updated.error) {
    throw updated.error;
  }

  return updated.data;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

if (isDirectRun()) {
  void main().catch((error) => {
    console.error("Failed to apply jornada laboral DOF correction", error);
    process.exitCode = 1;
  });
}

function isDirectRun(): boolean {
  return process.argv[1]?.endsWith("apply-jornada-laboral-dof-correction.ts") ?? false;
}
