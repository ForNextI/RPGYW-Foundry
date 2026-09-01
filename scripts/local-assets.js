const IMAGE_EXTENSIONS = Object.freeze([
  ".webp",
  ".png",
  ".jpg",
  ".jpeg",
  ".avif",
]);

const ASSET_BRANCH_HINTS = Object.freeze([
  "asset",
  "assets",
  "art",
  "arts",
  "image",
  "images",
  "media",
  "map",
  "maps",
  "battlemap",
  "battlemaps",
  "scene",
  "scenes",
  "token",
  "tokens",
  "portrait",
  "portraits",
  "icon",
  "icons",
]);

const WRAPPER_BRANCH_HINTS = Object.freeze([
  "content",
  "data",
  "public",
  "resources",
  "storage",
]);

const MAP_HINTS = Object.freeze([
  "map",
  "battlemap",
  "battle map",
  "scene",
  "encounter",
  "grid",
  "floorplan",
  "floor plan",
]);

const TOKEN_HINTS = Object.freeze([
  "token",
  "portrait",
  "creature",
  "monster",
  "npc",
  "character",
  "actor",
]);

const STOP_WORDS = new Set([
  "about", "after", "again", "against", "along", "also",
  "another", "around", "because", "before", "being", "between",
  "both", "could", "from", "have", "into", "just", "more",
  "most", "other", "over", "party", "player", "players",
  "roll", "rolled", "round", "scene", "their", "there",
  "these", "they", "this", "through", "turn", "under",
  "using", "very", "when", "where", "which", "while",
  "with", "would", "your",
]);

const MAX_BROWSED_DIRECTORIES = 180;
const MAX_INDEXED_FILES = 4_000;
const MAX_DEPTH = 5;

let imageIndexPromise = null;

function normalize(value) {
  return String(value ?? "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizePath(value) {
  return String(value ?? "")
    .toLocaleLowerCase()
    .replace(/[%_-]+/g, " ")
    .replace(/[^a-z0-9/ .]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pathValue(value) {
  if (typeof value === "string") {
    return value;
  }

  if (
    value
      && typeof value === "object"
      && typeof value.path === "string"
  ) {
    return value.path;
  }

  return null;
}

function filePickerClass() {
  return globalThis.foundry?.applications?.apps?.FilePicker
    ?? globalThis.FilePicker
    ?? null;
}

function hasImageExtension(path) {
  const normalized = String(path ?? "").toLocaleLowerCase();
  return IMAGE_EXTENSIONS.some(
    (extension) => normalized.endsWith(extension),
  );
}

function lastPathPart(path) {
  return String(path ?? "")
    .split("/")
    .filter(Boolean)
    .at(-1)
    ?? "";
}

function branchLooksUseful(path) {
  const leaf = normalize(lastPathPart(path));

  return (
    ASSET_BRANCH_HINTS.some(
      (hint) => leaf.includes(hint),
    )
      || WRAPPER_BRANCH_HINTS.some(
        (hint) => leaf === hint,
      )
  );
}

function isInsideAssetBranch(path) {
  const normalized = normalizePath(path);

  return ASSET_BRANCH_HINTS.some(
    (hint) => normalized.includes(`/${hint}`)
      || normalized.endsWith(hint),
  );
}

async function browseDirectory(FilePickerClass, target) {
  try {
    return await FilePickerClass.browse(
      "data",
      target,
      {
        extensions: IMAGE_EXTENSIONS,
      },
    );
  } catch {
    return null;
  }
}

async function buildImageIndex() {
  const FilePickerClass = filePickerClass();

  if (!FilePickerClass?.browse) {
    return [];
  }

  const roots = (
    await Promise.all([
      browseDirectory(FilePickerClass, "modules"),
      browseDirectory(FilePickerClass, "systems/dnd5e"),
    ])
  ).filter(Boolean);

  if (roots.length === 0) {
    return [];
  }

  const files = [];
  const seenFiles = new Set();
  const queue = [];
  const seenDirectories = new Set();

  for (const root of roots) {
    for (const rawFile of root.files ?? []) {
      const path = pathValue(rawFile);

      if (
        path
          && hasImageExtension(path)
          && !seenFiles.has(path)
      ) {
        seenFiles.add(path);
        files.push(path);
      }
    }

    for (const rawDirectory of root.dirs ?? []) {
      const path = pathValue(rawDirectory);

      if (path) {
        queue.push({
          path,
          depth: 0,
          inAssetBranch: false,
        });
      }
    }
  }

  let browsedDirectories = 0;

  while (
    queue.length > 0
      && browsedDirectories < MAX_BROWSED_DIRECTORIES
      && files.length < MAX_INDEXED_FILES
  ) {
    const current = queue.shift();

    if (
      !current
        || seenDirectories.has(current.path)
    ) {
      continue;
    }

    seenDirectories.add(current.path);
    browsedDirectories += 1;

    const result = await browseDirectory(
      FilePickerClass,
      current.path,
    );

    if (!result) {
      continue;
    }

    for (const rawFile of result.files ?? []) {
      if (files.length >= MAX_INDEXED_FILES) {
        break;
      }

      const path = pathValue(rawFile);

      if (
        path
          && hasImageExtension(path)
          && !seenFiles.has(path)
      ) {
        seenFiles.add(path);
        files.push(path);
      }
    }

    if (current.depth >= MAX_DEPTH) {
      continue;
    }

    for (const rawDirectory of result.dirs ?? []) {
      const path = pathValue(rawDirectory);

      if (!path) {
        continue;
      }

      const nextIsAssetBranch = (
        current.inAssetBranch
          || isInsideAssetBranch(path)
          || branchLooksUseful(path)
      );

      if (
        current.depth === 0
          ? branchLooksUseful(path)
          : nextIsAssetBranch
      ) {
        queue.push({
          path,
          depth: current.depth + 1,
          inAssetBranch: nextIsAssetBranch,
        });
      }
    }
  }

  console.info(
    `rpg-your-way-integrator | indexed ${files.length} local Foundry image path${files.length === 1 ? "" : "s"} across ${browsedDirectories} director${browsedDirectories === 1 ? "y" : "ies"}`,
  );

  return files;
}

async function localImageIndex() {
  if (!imageIndexPromise) {
    imageIndexPromise = buildImageIndex().catch(
      (error) => {
        console.warn(
          "rpg-your-way-integrator | local asset index unavailable",
          error,
        );
        return [];
      },
    );
  }

  return imageIndexPromise;
}

function addTerm(target, raw) {
  const normalized = normalize(raw);

  if (
    normalized.length < 3
      || STOP_WORDS.has(normalized)
  ) {
    return;
  }

  target.add(normalized);

  if (
    normalized.length > 4
      && normalized.endsWith("ies")
  ) {
    target.add(`${normalized.slice(0, -3)}y`);
  } else if (
    normalized.length > 4
      && normalized.endsWith("s")
      && !normalized.endsWith("ss")
  ) {
    target.add(normalized.slice(0, -1));
  }
}

function meaningfulTerms(...values) {
  const terms = new Set();

  for (const value of values.flat(Infinity)) {
    const normalized = normalize(value);

    for (const part of normalized.split(/\s+/)) {
      addTerm(terms, part);
    }
  }

  return [...terms].slice(0, 40);
}

function includesHint(path, hints) {
  return hints.some(
    (hint) => path.includes(hint),
  );
}

function scoreImage(path, terms, kind) {
  const normalized = normalizePath(path);
  let score = 0;

  for (const term of terms) {
    if (normalized.includes(term)) {
      score += term.length >= 7 ? 4 : 3;
    }
  }

  if (kind === "map") {
    if (includesHint(normalized, MAP_HINTS)) {
      score += 5;
    }

    if (includesHint(normalized, TOKEN_HINTS)) {
      score -= 8;
    }
  } else {
    if (includesHint(normalized, TOKEN_HINTS)) {
      score += 5;
    }

    if (includesHint(normalized, MAP_HINTS)) {
      score -= 8;
    }
  }

  return score;
}

async function bestImage({
  terms,
  kind,
  minimumScore,
}) {
  if (terms.length === 0) {
    return null;
  }

  const files = await localImageIndex();
  let best = null;
  let bestScore = minimumScore - 1;

  for (const path of files) {
    const score = scoreImage(
      path,
      terms,
      kind,
    );

    if (score > bestScore) {
      best = path;
      bestScore = score;
    }
  }

  return best;
}

function loadImageDimensions(src) {
  return new Promise((resolve) => {
    const image = new Image();
    const timeout = window.setTimeout(
      () => resolve(null),
      2_500,
    );

    image.onload = () => {
      window.clearTimeout(timeout);
      resolve({
        width: image.naturalWidth,
        height: image.naturalHeight,
      });
    };

    image.onerror = () => {
      window.clearTimeout(timeout);
      resolve(null);
    };

    image.src = src;
  });
}

export async function resolveLocalMapImage(sceneSpec, extraTerms = []) {
  const terms = meaningfulTerms(
    sceneSpec?.label,
    sceneSpec?.summary,
    extraTerms,
  );

  const src = await bestImage({
    terms,
    kind: "map",
    minimumScore: 8,
  });

  if (!src) {
    return null;
  }

  const dimensions = await loadImageDimensions(src);

  return {
    src,
    width: dimensions?.width ?? null,
    height: dimensions?.height ?? null,
  };
}

let compendiumVisualIndexPromise = null;

async function compendiumVisualIndex() {
  if (!compendiumVisualIndexPromise) {
    compendiumVisualIndexPromise = (async () => {
      const rows = [];

      for (const pack of game.packs ?? []) {
        if (pack.documentName !== "Actor") continue;

        try {
          const index = await pack.getIndex({
            fields: [
              "name",
              "img",
              "prototypeToken.texture.src",
            ],
          });

          for (const entry of index ?? []) {
            const tokenSrc = (
              entry.prototypeToken?.texture?.src
                || foundry?.utils?.getProperty?.(
                  entry,
                  "prototypeToken.texture.src",
                )
                || entry.img
                || null
            );

            if (!tokenSrc) continue;
            rows.push({
              name: String(entry.name || ""),
              src: String(tokenSrc),
              packageName: String(
                pack.metadata?.packageName
                  || pack.metadata?.package
                  || pack.collection
                  || "",
              ),
            });
          }
        } catch {
          // Packs that decline indexing simply do not participate.
        }
      }

      return rows.slice(0, 8_000);
    })();
  }

  return compendiumVisualIndexPromise;
}

export async function resolveCompendiumTokenImage({
  name,
  visualTags = [],
  sceneSummary = "",
}) {
  const terms = meaningfulTerms(
    name,
    visualTags,
    sceneSummary,
  );
  if (terms.length === 0) return null;

  const rows = await compendiumVisualIndex();
  let best = null;
  let bestScore = 6;

  for (const row of rows) {
    const searchable = normalizePath(
      `${row.name} ${row.src} ${row.packageName}`,
    );
    let score = normalize(row.name) === normalize(name) ? 8 : 0;

    for (const term of terms) {
      if (searchable.includes(term)) {
        score += term.length >= 7 ? 4 : 3;
      }
    }

    if (score > bestScore) {
      best = row.src;
      bestScore = score;
    }
  }

  return best;
}

export async function resolveLocalTokenImage({
  name,
  visualTags = [],
  sceneSummary = "",
}) {
  const terms = meaningfulTerms(
    name,
    visualTags,
    sceneSummary,
  );

  return bestImage({
    terms,
    kind: "token",
    minimumScore: 7,
  });
}
