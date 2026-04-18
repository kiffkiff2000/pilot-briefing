import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type BriefingRow = {
  id: string;
  departure: string;
  destination: string;
  alternates: string | null;
  briefing_text: string;
  created_at: string;
};

export type SaveBriefingInput = {
  departure: string;
  destination: string;
  alternates: string | null;
  briefing_text: string;
};

function getSupabase(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set");
  }

  return createClient(url, key);
}

export async function saveBriefing(data: SaveBriefingInput): Promise<{ id: string }> {
  const supabase = getSupabase();

  const { data: row, error } = await supabase
    .from("briefings")
    .insert({
      departure: data.departure,
      destination: data.destination,
      alternates: data.alternates,
      briefing_text: data.briefing_text,
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return { id: row.id as string };
}

export async function getBriefings(): Promise<BriefingRow[]> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("briefings")
    .select("id, departure, destination, alternates, briefing_text, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as BriefingRow[];
}

export async function getBriefingById(id: string): Promise<BriefingRow | null> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("briefings")
    .select("id, departure, destination, alternates, briefing_text, created_at")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data as BriefingRow | null;
}
