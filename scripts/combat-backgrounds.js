import { MODULE_ID } from "./settings.js";
const BASE=`modules/${MODULE_ID}/assets/combat-backgrounds`;
const BG=Object.freeze({wood:`${BASE}/rtp-combat-background-wood-floor.webp`,street:`${BASE}/rtp-combat-background-street-cobbles.webp`,field:`${BASE}/rtp-combat-background-field-wagon-road.webp`,dungeon:`${BASE}/rtp-combat-background-dungeon-stone.webp`});
const FLAG="managedSetupWall";
function clean(v){return String(v??"").toLocaleLowerCase();}
export function combatBackgroundForSetup(setup,sceneSpec={}){
 const t=clean([setup?.environment,sceneSpec?.label,sceneSpec?.summary,...(setup?.asset_search_terms??[])].join(" "));
 if (/\b(dungeon|crypt|catacomb|cavern|cave|sewer|underdark|stone chamber|ruin)\b/.test(t)) return BG.dungeon;
 if (/\b(street|alley|plaza|square|city|town|village|urban|market|cobbles|dock)\b/.test(t)) return BG.street;
 if (/\b(field|road|trail|forest|woods|grass|meadow|farm|camp|wilderness|outdoor)\b/.test(t)) return BG.field;
 return BG.wood;
}
function px(v,g){return Math.round((Number(v)||0)/5*g);} function normal(){return CONST?.WALL_SENSE_TYPES?.NORMAL??20;} function none(){return CONST?.WALL_SENSE_TYPES?.NONE??0;}
function segment(f,g){const x=px(f.x_ft,g),y=px(f.y_ft,g),w=Math.max(g,px(f.width_ft,g)),h=Math.max(g,px(f.height_ft,g)); if(w>=h){const yy=y+Math.round(h/2);return[x,yy,x+w,yy];} const xx=x+Math.round(w/2);return[xx,y,xx,y+h];}
function data(setup,scene){if(!setup)return[];const g=Number(scene.grid?.size)||100;return(setup.features??[]).flatMap(f=>{if(!["wall","door","window"].includes(f.kind))return[];const door=f.kind==="door",win=f.kind==="window";return[{c:segment(f,g),move:normal(),sight:win?none():normal(),door:door?(CONST?.WALL_DOOR_TYPES?.DOOR??1):(CONST?.WALL_DOOR_TYPES?.NONE??0),ds:CONST?.WALL_DOOR_STATES?.CLOSED??0,flags:{[MODULE_ID]:{[FLAG]:true,setupKind:f.kind,setupLabel:String(f.label||"").slice(0,80)}}}];});}
export async function redrawSetupWalls(scene,setup){const ids=Array.from(scene.walls??[]).filter(w=>w.getFlag(MODULE_ID,FLAG)===true).map(w=>w.id).filter(Boolean);if(ids.length)await scene.deleteEmbeddedDocuments("Wall",ids);const walls=data(setup,scene);if(walls.length)await scene.createEmbeddedDocuments("Wall",walls);}
