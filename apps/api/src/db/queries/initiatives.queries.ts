import { supabaseAdmin } from "../supabase.js";
import type { InitiativeDetailRpcRow } from "./rpc.types.js";

export async function getInitiativeDetailRpc(initiativeId: string): Promise<InitiativeDetailRpcRow | null> {
  const { data, error } = await supabaseAdmin.rpc("get_initiative_detail", {
    p_initiative_id: initiativeId
  });

  if (error) {
    throw new Error(`get_initiative_detail RPC failed: ${error.message}`);
  }

  const rows = (data ?? []) as InitiativeDetailRpcRow[];
  return rows[0] ?? null;
}

