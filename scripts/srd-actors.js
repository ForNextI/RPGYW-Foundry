const INDEX_FIELDS = Object.freeze(["name", "type", "img", "prototypeToken.texture.src", "prototypeToken.width", "prototypeToken.height"]);
const packCache = new Map();
function normalize(value) { return String(value ?? "").normalize("NFKD").toLocaleLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim(); }
function packageName(pack) { return String(pack?.metadata?.packageName || pack?.metadata?.package || ""); }
function descriptor(pack) { return normalize([pack?.collection,pack?.metadata?.label,pack?.metadata?.name,packageName(pack)].join(" ")); }
function priority(pack) {
  const d=descriptor(pack); if (d.includes("premade")) return -1000; let s=0;
  if (packageName(pack)==="dnd5e") s+=100;
  if (d.includes("monster")) s+=50; if (d.includes("actor")) s+=35;
  if (d.includes("2024")||d.includes("modern")||d.includes("monsters24")||d.includes("actors24")) s+=80;
  return s;
}
async function indexFor(pack) {
  const k=String(pack.collection||""); if (packCache.has(k)) return packCache.get(k);
  try { const v=Array.from(await pack.getIndex({fields:INDEX_FIELDS}) ?? []); packCache.set(k,v); return v; }
  catch { packCache.set(k,[]); return []; }
}
export async function resolveSrdActorTemplate(templateName) {
  const target=normalize(templateName); if (!target) return null; const matches=[];
  for (const pack of game.packs ?? []) {
    if (pack.documentName!=="Actor") continue; const p=priority(pack); if (p<0) continue;
    const entry=(await indexFor(pack)).find(c=>normalize(c.name)===target); if (entry?._id) matches.push({pack,entry,p});
  }
  matches.sort((a,b)=>b.p-a.p);
  for (const m of matches) { try { const document=await m.pack.getDocument(m.entry._id); if (document) return {packId:String(m.pack.collection||""),documentId:String(m.entry._id),document}; } catch {} }
  return null;
}
function strip(data) { const c={...data}; delete c._id; delete c._stats; delete c.folder; delete c.sort; delete c.ownership; return c; }
export async function createActorFromSrdTemplate({templateName,displayName,flags,disposition,displayNameMode,displayBarsMode,hpBarAttribute="attributes.hp"}) {
  const match=await resolveSrdActorTemplate(templateName); if (!match) return null;
  const data=strip(match.document.toObject()); data.name=displayName; data.flags={...(data.flags??{}),...flags};
  data.prototypeToken={...(data.prototypeToken??{}),name:displayName,actorLink:true,disposition,displayName:displayNameMode,displayBars:displayBarsMode,
    bar1:{...(data.prototypeToken?.bar1??{}),attribute:hpBarAttribute},
    texture:{...(data.prototypeToken?.texture??{}),src:data.prototypeToken?.texture?.src||data.img||"icons/svg/mystery-man.svg"}};
  const actor=await Actor.create(data); if (!actor) return null;
  await actor.setFlag("rpg-your-way-integrator","srdTemplate",templateName);
  await actor.setFlag("rpg-your-way-integrator","srdSourcePack",match.packId);
  await actor.setFlag("rpg-your-way-integrator","srdSourceDocumentId",match.documentId);
  return actor;
}
