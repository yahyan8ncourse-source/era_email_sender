const MAX_FILES = 5;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 15 * 1024 * 1024;

function validateAttachments(raw) {
  if (!raw || !raw.length) return [];

  if (raw.length > MAX_FILES) {
    throw new Error(`Maximum ${MAX_FILES} pièces jointes par email.`);
  }

  let total = 0;
  const out = [];

  for (const item of raw) {
    const filename = String(item.filename || "fichier").trim();
    const content = String(item.content || "");
    const contentType = String(item.contentType || "application/octet-stream");

    if (!content) {
      throw new Error(`Pièce jointe invalide : ${filename}`);
    }

    const bytes = Buffer.byteLength(content, "base64");
    if (bytes > MAX_FILE_BYTES) {
      throw new Error(`Fichier trop volumineux (max 5 Mo) : ${filename}`);
    }

    total += bytes;
    if (total > MAX_TOTAL_BYTES) {
      throw new Error("Taille totale des pièces jointes trop grande (max 15 Mo).");
    }

    out.push({ filename, contentType, content });
  }

  return out.map((item) => ({
    filename: item.filename,
    contentType: item.contentType,
    content: Buffer.from(item.content, "base64"),
  }));
}

module.exports = { validateAttachments, MAX_FILES, MAX_FILE_BYTES };
