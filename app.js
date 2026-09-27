import { signInWithEmail, signOut, watchAuth } from "./supabase.js";
import {
  FIELD_TEMPLATES,
  watchCollections,
  watchItems,
  fetchCollections,
  fetchItems,
  ensureDefaultCollections,
  importSeedData,
  addCollection,
  updateCollection,
  deleteCollection,
  addItem,
  updateItem,
  deleteItem,
  setItemDone,
} from "./store.js";

const state = {
  uid: null,
  collections: [],
  items: [],
  activeKey: null,
  filter: "all",
  search: "",
  editingItemId: null,
  sharedPrefill: null,
};

let unsubCollections = null;
let unsubItems = null;
let ensuredUid = null;

// --- DOM refs ---
const authScreen = document.getElementById("authScreen");
const appEl = document.getElementById("app");
const authForm = document.getElementById("authForm");
const authEmail = document.getElementById("authEmail");
const authMessage = document.getElementById("authMessage");
const tabTitle = document.getElementById("tabTitle");
const tabSub = document.getElementById("tabSub");
const searchInput = document.getElementById("search");
const filtersEl = document.getElementById("filters");
const listEl = document.getElementById("list");
const fab = document.getElementById("fab");
const tabsEl = document.getElementById("tabs");
const sheetBackdrop = document.getElementById("sheetBackdrop");
const sheetTitle = document.getElementById("sheetTitle");
const sheetFields = document.getElementById("sheetFields");
const cancelBtn = document.getElementById("cancelBtn");
const saveBtn = document.getElementById("saveBtn");
const deleteRow = document.getElementById("deleteRow");
const deleteBtn = document.getElementById("deleteBtn");
const settingsBackdrop = document.getElementById("settingsBackdrop");
const collectionsManager = document.getElementById("collectionsManager");
const addCollectionBtn = document.getElementById("addCollectionBtn");
const importSeedBtn = document.getElementById("importSeedBtn");
const signOutBtn = document.getElementById("signOutBtn");
const closeSettingsBtn = document.getElementById("closeSettingsBtn");
const toastEl = document.getElementById("toast");

// --- icons ---
function iconSvg(shape, color) {
  const s = `stroke="${color}" stroke-width="1.5" fill="none"`;
  if (shape === "triangle") return `<svg viewBox="0 0 18 18"><path d="M9 2.5 L16 15.5 L2 15.5 Z" ${s} stroke-linejoin="round"/></svg>`;
  if (shape === "square") return `<svg viewBox="0 0 18 18"><rect x="3" y="3" width="12" height="12" rx="2.5" ${s}/></svg>`;
  if (shape === "diamond") return `<svg viewBox="0 0 18 18"><path d="M9 2 L16 9 L9 16 L2 9 Z" ${s} stroke-linejoin="round"/></svg>`;
  return `<svg viewBox="0 0 18 18"><circle cx="9" cy="9" r="6.5" ${s}/></svg>`;
}

function escapeHTML(s) {
  return (s || "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}

function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toastEl.classList.remove("show"), 1800);
}

// --- share target prefill (Android "Partager vers") ---
function readSharePayload() {
  const params = new URLSearchParams(window.location.search);
  const text = params.get("text") || params.get("url") || "";
  const title = params.get("title") || "";
  if (!text && !title) return null;
  const urlMatch = text.match(/https?:\/\/\S+/);
  return {
    title: title || "",
    url: urlMatch ? urlMatch[0] : text.startsWith("http") ? text : "",
    description: !urlMatch && !text.startsWith("http") ? text : "",
  };
}

// --- auth ---
authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = authEmail.value.trim();
  if (!email) return;
  authForm.querySelector("button").disabled = true;
  try {
    await signInWithEmail(email);
    authMessage.textContent = `Lien envoyé à ${email}, ouvre-le depuis ce téléphone/navigateur pour te connecter.`;
    authMessage.style.display = "block";
  } catch (err) {
    authMessage.textContent = "Échec de l'envoi, réessaie.";
    authMessage.style.display = "block";
  }
  authForm.querySelector("button").disabled = false;
});
signOutBtn.addEventListener("click", () => signOut());

watchAuth((user) => {
  if (unsubCollections) unsubCollections();
  if (unsubItems) unsubItems();

  if (!user) {
    state.uid = null;
    authScreen.classList.remove("hidden");
    appEl.classList.add("hidden");
    return;
  }

  state.uid = user.id;
  authScreen.classList.add("hidden");
  appEl.classList.remove("hidden");
  state.sharedPrefill = readSharePayload();

  if (ensuredUid !== state.uid) {
    ensuredUid = state.uid;
    ensureDefaultCollections(state.uid).catch(() => {});
  }

  unsubCollections = watchCollections(state.uid, (collections) => {
    state.collections = collections;
    if (!state.activeKey && collections.length) state.activeKey = collections[0].key;
    renderTabs();
    renderFilters();
    renderList();
    renderCollectionsManager();

    if (state.sharedPrefill) {
      const payload = state.sharedPrefill;
      state.sharedPrefill = null;
      openItemSheet(null);
      sheetFields.querySelector('[data-f="title"]').value = payload.title;
      sheetFields.querySelector('[data-f="url"]').value = payload.url;
      if (payload.description) sheetFields.querySelector('[data-f="description"]').value = payload.description;
    }
  });

  unsubItems = watchItems(state.uid, (items) => {
    state.items = items;
    renderList();
  });
});

// --- helpers ---
function activeCollection() {
  return state.collections.find((c) => c.key === state.activeKey);
}

// Le live sync (postgres_changes) rafraîchit les autres appareils, mais on ne
// s'y fie pas pour refléter nos propres écritures : on refetch en direct pour
// que l'appareil qui vient d'écrire voie le résultat tout de suite.
async function refreshCollections() {
  state.collections = await fetchCollections(state.uid);
  renderTabs();
  renderFilters();
  renderList();
  renderCollectionsManager();
}
async function refreshItems() {
  state.items = await fetchItems(state.uid);
  renderList();
}

function itemsForActive() {
  const col = activeCollection();
  if (!col) return [];
  let items = state.items.filter((i) => i.collectionKey === col.key);
  if (state.filter === "todo") items = items.filter((i) => !i.done);
  if (state.filter === "done") items = items.filter((i) => i.done);
  if (state.search) {
    const q = state.search.toLowerCase();
    items = items.filter(
      (i) =>
        (i.title || "").toLowerCase().includes(q) ||
        (i.description || "").toLowerCase().includes(q) ||
        (i.extra || "").toLowerCase().includes(q)
    );
  }
  return items;
}

function applyAccent(col) {
  document.documentElement.style.setProperty("--accent", col.accent);
  document.documentElement.style.setProperty("--accent-bg", col.accentBg);
}

// --- rendering ---
function renderTabs() {
  tabsEl.innerHTML = "";
  for (const col of state.collections) {
    const btn = document.createElement("button");
    btn.className = col.key === state.activeKey ? "active" : "";
    const color = col.key === state.activeKey ? col.accent : "#A99A85";
    btn.innerHTML = `${iconSvg(col.icon, color)}<span>${escapeHTML(col.name)}</span>`;
    btn.onclick = () => {
      state.activeKey = col.key;
      state.filter = "all";
      state.search = "";
      searchInput.value = "";
      renderTabs();
      renderFilters();
      renderList();
    };
    tabsEl.appendChild(btn);
  }
  const gear = document.createElement("button");
  gear.innerHTML = `<svg viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="2.6" stroke="#A99A85" stroke-width="1.5"/><path d="M9 2.5v2M9 13.5v2M2.5 9h2M13.5 9h2M4.4 4.4l1.4 1.4M12.2 12.2l1.4 1.4M13.6 4.4l-1.4 1.4M5.8 12.2l-1.4 1.4" stroke="#A99A85" stroke-width="1.4" stroke-linecap="round"/></svg><span>Réglages</span>`;
  gear.onclick = () => settingsBackdrop.classList.add("open");
  tabsEl.appendChild(gear);
}

function renderFilters() {
  const col = activeCollection();
  if (!col) return;
  applyAccent(col);
  const opts = [
    ["all", "Tout"],
    ["todo", col.statusLabels[0]],
    ["done", col.statusLabels[1]],
  ];
  filtersEl.innerHTML = opts
    .map(([key, label]) => `<button data-f="${key}" class="${state.filter === key ? "active" : ""}">${escapeHTML(label)}</button>`)
    .join("");
  filtersEl.querySelectorAll("button").forEach((b) => {
    b.onclick = () => {
      state.filter = b.dataset.f;
      renderFilters();
      renderList();
    };
  });
}

function cardHTML(item, col) {
  const done = item.done;
  let extraBlock = "";
  if (col.fieldTemplate === "meta" && item.extra) {
    extraBlock = `<p class="meta-line">${escapeHTML(item.extra)}</p>`;
  } else if (col.fieldTemplate === "ingredients" && item.extra) {
    extraBlock = `<div class="chips">${item.extra
      .split(",")
      .map((x) => `<span class="chip">${escapeHTML(x.trim())}</span>`)
      .join("")}</div>`;
  } else if (col.fieldTemplate === "category" && item.extra) {
    extraBlock = `<div class="chips"><span class="chip">${escapeHTML(item.extra)}</span></div>`;
  }
  return `
  <div class="card-shell ${done ? "done" : ""}" data-id="${item.id}">
    <div class="card">
      <h3 class="serif">${escapeHTML(item.title)}</h3>
      ${extraBlock}
      <p class="desc">${escapeHTML(item.description || "")}</p>
      <div class="card-actions">
        <button class="status-btn" data-action="toggle" data-id="${item.id}">
          <span class="status-dot"></span>${done ? col.statusLabels[1] : col.statusLabels[0]}
        </button>
        <div class="card-links">
          ${item.url ? `<button class="icon-btn" data-action="open" data-id="${item.id}">Voir le post ↗</button>` : ""}
          <button class="icon-btn" data-action="edit" data-id="${item.id}">Modifier</button>
        </div>
      </div>
    </div>
  </div>`;
}

function renderList() {
  const col = activeCollection();
  if (!col) {
    listEl.innerHTML = `<div class="empty">Crée ta première collection dans les réglages.</div>`;
    tabTitle.textContent = "Archives";
    tabSub.textContent = "";
    return;
  }
  applyAccent(col);
  const items = itemsForActive();
  tabTitle.textContent = col.name;
  const total = state.items.filter((i) => i.collectionKey === col.key).length;
  const doneCount = state.items.filter((i) => i.collectionKey === col.key && i.done).length;
  tabSub.textContent = `${total} élément${total > 1 ? "s" : ""} · ${doneCount} ${col.statusLabels[1].toLowerCase()}`;

  if (!items.length) {
    listEl.innerHTML = `<div class="empty">Rien ici pour l'instant.<br>Ajoute un élément avec le bouton +.</div>`;
    return;
  }
  listEl.innerHTML = items.map((i) => cardHTML(i, col)).join("");

  listEl.querySelectorAll('[data-action="toggle"]').forEach((b) => {
    b.onclick = async () => {
      const item = state.items.find((i) => i.id === b.dataset.id);
      try {
        await setItemDone(state.uid, item.id, !item.done);
        await refreshItems();
      } catch (e) {
        showToast("Échec, réessaie");
      }
    };
  });
  listEl.querySelectorAll('[data-action="open"]').forEach((b) => {
    b.onclick = () => {
      const item = state.items.find((i) => i.id === b.dataset.id);
      if (item?.url) window.open(item.url, "_blank");
    };
  });
  listEl.querySelectorAll('[data-action="edit"]').forEach((b) => {
    b.onclick = () => openItemSheet(b.dataset.id);
  });
}

searchInput.addEventListener("input", (e) => {
  state.search = e.target.value;
  renderList();
});

// --- item sheet (add/edit) ---
function openItemSheet(id) {
  const col = activeCollection();
  if (!col) return;
  state.editingItemId = id || null;
  const item = id ? state.items.find((i) => i.id === id) : {};
  sheetTitle.textContent = id ? "Modifier" : "Nouvel élément — " + col.name;

  const tpl = FIELD_TEMPLATES[col.fieldTemplate] || FIELD_TEMPLATES.none;
  const fields = [{ name: "title", label: "Titre", type: "input" }];
  if (tpl.label) fields.push({ name: "extra", label: tpl.label, type: "input", placeholder: tpl.placeholder });
  fields.push({ name: "description", label: "Description", type: "textarea" });
  fields.push({ name: "url", label: "Lien Instagram", type: "input" });

  sheetFields.innerHTML = fields
    .map(
      (f) => `
    <div class="field">
      <label>${f.label}</label>
      ${
        f.type === "textarea"
          ? `<textarea data-f="${f.name}">${escapeHTML(item[f.name] || "")}</textarea>`
          : `<input data-f="${f.name}" value="${escapeHTML(item[f.name] || "")}" placeholder="${escapeHTML(f.placeholder || "")}">`
      }
    </div>`
    )
    .join("");

  deleteRow.style.display = id ? "flex" : "none";
  sheetBackdrop.classList.add("open");
}

function closeItemSheet() {
  sheetBackdrop.classList.remove("open");
  state.editingItemId = null;
}

cancelBtn.onclick = closeItemSheet;
sheetBackdrop.onclick = (e) => {
  if (e.target === sheetBackdrop) closeItemSheet();
};

saveBtn.onclick = async () => {
  const col = activeCollection();
  const values = {};
  sheetFields.querySelectorAll("[data-f]").forEach((el) => (values[el.dataset.f] = el.value.trim()));
  if (!values.title) {
    showToast("Ajoute au moins un titre");
    return;
  }
  values.collectionKey = col.key;
  try {
    if (state.editingItemId) {
      await updateItem(state.uid, state.editingItemId, values);
      showToast("Modifié");
    } else {
      await addItem(state.uid, { ...values, done: false });
      showToast("Ajouté");
    }
    closeItemSheet();
    await refreshItems();
  } catch (e) {
    showToast("Échec de l'enregistrement, réessaie");
  }
};

deleteBtn.onclick = async () => {
  if (!state.editingItemId) return;
  try {
    await deleteItem(state.uid, state.editingItemId);
    closeItemSheet();
    showToast("Supprimé");
    await refreshItems();
  } catch (e) {
    showToast("Échec de la suppression, réessaie");
  }
};

fab.onclick = () => openItemSheet(null);

// --- settings: collections manager ---
function renderCollectionsManager() {
  collectionsManager.innerHTML = state.collections
    .map(
      (col) => `
    <div class="field" style="display:flex; align-items:center; gap:10px; margin-bottom:10px;">
      <input data-rename="${col.id}" value="${escapeHTML(col.name)}" style="flex:1; padding:10px 12px; border-radius:12px; border:1px solid var(--line); font-family:inherit;">
      <button class="btn danger" data-delete="${col.id}" data-key="${col.key}" style="flex:none; padding:10px 14px;">Suppr.</button>
    </div>`
    )
    .join("");

  collectionsManager.querySelectorAll("[data-rename]").forEach((input) => {
    input.addEventListener("change", async () => {
      try {
        await updateCollection(state.uid, input.dataset.rename, { name: input.value.trim() });
        await refreshCollections();
      } catch (e) {
        showToast("Échec du renommage, réessaie");
      }
    });
  });
  collectionsManager.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.onclick = async () => {
      if (state.collections.length <= 1) {
        showToast("Garde au moins une collection");
        return;
      }
      try {
        await deleteCollection(state.uid, btn.dataset.delete, btn.dataset.key);
        if (state.activeKey === btn.dataset.key) state.activeKey = null;
        await refreshCollections();
        await refreshItems();
        showToast("Collection supprimée");
      } catch (e) {
        showToast("Échec de la suppression, réessaie");
      }
    };
  });
}

const PRESET_ACCENTS = ["#3B4B9E", "#A97A1F", "#6E3B5C", "#1F7A6C", "#B5473B", "#2F6F8F"];

addCollectionBtn.onclick = async () => {
  const name = window.prompt("Nom de la nouvelle collection :");
  if (!name || !name.trim()) return;
  const tplChoice = window.prompt("Champ supplémentaire : laisse vide pour aucun, ou tape \"tag\" (catégorie), \"liste\" (ingrédients/éléments), ou \"detail\" (année/genre/durée)");
  let fieldTemplate = "none";
  if (tplChoice === "tag") fieldTemplate = "category";
  if (tplChoice === "liste") fieldTemplate = "ingredients";
  if (tplChoice === "detail") fieldTemplate = "meta";
  const accent = PRESET_ACCENTS[state.collections.length % PRESET_ACCENTS.length];
  try {
    await addCollection(state.uid, {
      key: `c_${Date.now()}`,
      name: name.trim(),
      icon: "circle",
      accent,
      accentBg: accent + "1F",
      statusLabels: ["À faire", "Fait"],
      fieldTemplate,
      order: state.collections.length,
    });
    showToast("Collection créée");
    await refreshCollections();
  } catch (e) {
    showToast("Échec de la création, réessaie");
  }
};

importSeedBtn.onclick = async () => {
  importSeedBtn.disabled = true;
  importSeedBtn.textContent = "Import en cours…";
  try {
    const count = await importSeedData(state.uid);
    showToast(`${count} éléments importés`);
    await refreshItems();
  } catch (e) {
    showToast("Échec de l'import");
  }
  importSeedBtn.disabled = false;
  importSeedBtn.textContent = "Importer les données de démo (103 items)";
};

closeSettingsBtn.onclick = () => settingsBackdrop.classList.remove("open");
settingsBackdrop.onclick = (e) => {
  if (e.target === settingsBackdrop) settingsBackdrop.classList.remove("open");
};

// --- service worker ---
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
