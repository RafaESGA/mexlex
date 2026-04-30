import { supabaseAdmin } from "../supabase.js";
import type { SearchByAuthorRpcRow, SearchInitiativesRpcRow } from "./rpc.types.js";

export async function searchInitiativesRpc(input: {
  query: string;
  limit: number;
  offset: number;
}): Promise<SearchInitiativesRpcRow[]> {
  const { data, error } = await supabaseAdmin.rpc("search_initiatives", {
    p_query: input.query,
    p_limit: input.limit,
    p_offset: input.offset
  });

  if (error) {
    throw new Error(`search_initiatives RPC failed: ${error.message}`);
  }

  return (data ?? []) as SearchInitiativesRpcRow[];
}

export async function searchByAuthorRpc(input: {
  query: string;
  limit: number;
  offset: number;
}): Promise<SearchByAuthorRpcRow[]> {
  const { data, error } = await supabaseAdmin.rpc("search_by_author", {
    p_author_query: input.query,
    p_limit: input.limit,
    p_offset: input.offset
  });

  if (error) {
    throw new Error(`search_by_author RPC failed: ${error.message}`);
  }

  return (data ?? []) as SearchByAuthorRpcRow[];
}

