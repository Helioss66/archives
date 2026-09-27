import { supabase } from "./supabase.js";

export const DEFAULT_COLLECTIONS = [
  { key: "movies", name: "Films", icon: "triangle", accent: "#3B4B9E", accentBg: "#EAECF7", statusLabels: ["À voir", "Vu"], fieldTemplate: "meta", order: 0 },
  { key: "cuisine", name: "Cuisine", icon: "circle", accent: "#A97A1F", accentBg: "#F5EEDD", statusLabels: ["À faire", "Fait"], fieldTemplate: "ingredients", order: 1 },
  { key: "learning", name: "Apprentissage", icon: "square", accent: "#6E3B5C", accentBg: "#F0E3EC", statusLabels: ["À faire", "Fait"], fieldTemplate: "category", order: 2 },
  { key: "ia", name: "IA", icon: "diamond", accent: "#1F7A6C", accentBg: "#DFEEEA", statusLabels: ["À faire", "Fait"], fieldTemplate: "category", order: 3 },
];

export const FIELD_TEMPLATES = {
  none: { label: null, placeholder: null },
  meta: { label: "Année · genre · durée", placeholder: "ex : 2002 · Drame · 2h11" },
  ingredients: { label: "Ingrédients clés (séparés par des virgules)", placeholder: "ex : Poulet, ail, piment" },
  category: { label: "Catégorie", placeholder: "ex : Géopolitique" },
};

// --- local cache (lecture hors-ligne : les écritures demandent le réseau) ---
function cacheKey(kind, uid) {
  return `archives_cache_${kind}_${uid}`;
}
function cacheSet(kind, uid, data) {
  try {
    localStorage.setItem(cacheKey(kind, uid), JSON.stringify(data));
  } catch (e) {}
}
export function cacheGet(kind, uid) {
  try {
    const raw = localStorage.getItem(cacheKey(kind, uid));
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

// --- mapping DB <-> app ---
function collectionFromRow(r) {
  return {
    id: r.id,
    key: r.key,
    name: r.name,
    icon: r.icon,
    accent: r.accent,
    accentBg: r.accent_bg,
    statusLabels: r.status_labels,
    fieldTemplate: r.field_template,
    order: r.sort_order,
  };
}
function itemFromRow(r) {
  return {
    id: r.id,
    collectionKey: r.collection_key,
    title: r.title,
    description: r.description,
    url: r.url,
    extra: r.extra,
    done: r.done,
    createdAt: r.created_at,
  };
}

export async function fetchCollections(uid) {
  const { data, error } = await supabase.from("collections").select("*").eq("user_id", uid).order("sort_order");
  if (error) throw error;
  const collections = data.map(collectionFromRow);
  cacheSet("collections", uid, collections);
  return collections;
}
export async function fetchItems(uid) {
  const { data, error } = await supabase.from("items").select("*").eq("user_id", uid);
  if (error) throw error;
  const items = data.map(itemFromRow);
  cacheSet("items", uid, items);
  return items;
}

export function watchCollections(uid, onChange) {
  let cancelled = false;
  const cached = cacheGet("collections", uid);
  if (cached) onChange(cached);

  fetchCollections(uid)
    .then((data) => {
      if (cancelled) return;
      cacheSet("collections", uid, data);
      onChange(data);
    })
    .catch(() => {
      if (!cached) onChange([]);
    });

  const channel = supabase
    .channel(`collections-${uid}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "collections", filter: `user_id=eq.${uid}` }, () => {
      fetchCollections(uid).then((data) => {
        if (cancelled) return;
        cacheSet("collections", uid, data);
        onChange(data);
      });
    })
    .subscribe();

  return () => {
    cancelled = true;
    supabase.removeChannel(channel);
  };
}

export function watchItems(uid, onChange) {
  let cancelled = false;
  const cached = cacheGet("items", uid);
  if (cached) onChange(cached);

  fetchItems(uid)
    .then((data) => {
      if (cancelled) return;
      cacheSet("items", uid, data);
      onChange(data);
    })
    .catch(() => {
      if (!cached) onChange([]);
    });

  const channel = supabase
    .channel(`items-${uid}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "items", filter: `user_id=eq.${uid}` }, () => {
      fetchItems(uid).then((data) => {
        if (cancelled) return;
        cacheSet("items", uid, data);
        onChange(data);
      });
    })
    .subscribe();

  return () => {
    cancelled = true;
    supabase.removeChannel(channel);
  };
}

export async function ensureDefaultCollections(uid) {
  // upsert + ignoreDuplicates makes this safe to call more than once for the
  // same user (e.g. if the auth callback fires multiple times on load),
  // relying on the unique(user_id, key) constraint in schema.sql.
  const rows = DEFAULT_COLLECTIONS.map((c) => ({
    user_id: uid,
    key: c.key,
    name: c.name,
    icon: c.icon,
    accent: c.accent,
    accent_bg: c.accentBg,
    status_labels: c.statusLabels,
    field_template: c.fieldTemplate,
    sort_order: c.order,
  }));
  const { error } = await supabase.from("collections").upsert(rows, { onConflict: "user_id,key", ignoreDuplicates: true });
  if (error) throw error;
}

export async function importSeedData(uid) {
  const res = await fetch("./seed-data.json");
  const seed = await res.json();
  const rows = [];
  for (const [key, items] of Object.entries(seed)) {
    for (const item of items) {
      rows.push({
        user_id: uid,
        collection_key: key,
        title: item.title,
        description: item.description || "",
        url: item.url || "",
        extra: item.meta ?? item.ingredients ?? item.category ?? "",
        done: false,
      });
    }
  }
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await supabase.from("items").insert(rows.slice(i, i + 200));
    if (error) throw error;
  }
  return rows.length;
}

export async function addCollection(uid, data) {
  const { error } = await supabase.from("collections").insert({
    user_id: uid,
    key: data.key,
    name: data.name,
    icon: data.icon,
    accent: data.accent,
    accent_bg: data.accentBg,
    status_labels: data.statusLabels,
    field_template: data.fieldTemplate,
    sort_order: data.order,
  });
  if (error) throw error;
}

export async function updateCollection(uid, id, data) {
  const patch = {};
  if (data.name !== undefined) patch.name = data.name;
  const { error } = await supabase.from("collections").update(patch).eq("id", id).eq("user_id", uid);
  if (error) throw error;
}

export async function deleteCollection(uid, id, key) {
  await supabase.from("items").delete().eq("user_id", uid).eq("collection_key", key);
  const { error } = await supabase.from("collections").delete().eq("id", id).eq("user_id", uid);
  if (error) throw error;
}

export async function addItem(uid, data) {
  const { error } = await supabase.from("items").insert({
    user_id: uid,
    collection_key: data.collectionKey,
    title: data.title,
    description: data.description || "",
    url: data.url || "",
    extra: data.extra || "",
    done: data.done || false,
  });
  if (error) throw error;
}

export async function updateItem(uid, id, data) {
  const patch = {};
  if (data.title !== undefined) patch.title = data.title;
  if (data.description !== undefined) patch.description = data.description;
  if (data.url !== undefined) patch.url = data.url;
  if (data.extra !== undefined) patch.extra = data.extra;
  if (data.done !== undefined) patch.done = data.done;
  const { error } = await supabase.from("items").update(patch).eq("id", id).eq("user_id", uid);
  if (error) throw error;
}

export async function deleteItem(uid, id) {
  const { error } = await supabase.from("items").delete().eq("id", id).eq("user_id", uid);
  if (error) throw error;
}

export async function setItemDone(uid, id, done) {
  const { error } = await supabase.from("items").update({ done }).eq("id", id).eq("user_id", uid);
  if (error) throw error;
}
