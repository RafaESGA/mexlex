import { supabaseAdmin } from "../supabase.js";
import type { TimelineRpcRow } from "./rpc.types.js";

export async function getLegislativeTimelineRpc(initiativeId: string): Promise<TimelineRpcRow[]> {
  const { data, error } = await supabaseAdmin.rpc("get_legislative_timeline", {
    p_initiative_id: initiativeId
  });

  if (error) {
    throw new Error(`get_legislative_timeline RPC failed: ${error.message}`);
  }

  return (data ?? []) as TimelineRpcRow[];
}

