"use strict";

const axios = require("axios");

const commons = axios.create({
  timeout: 10000,
  headers: {
    "User-Agent": "WikiMaster/2.1 (Wikimedia Commons media discovery; educational project)",
    Accept: "application/json"
  },
  maxRedirects: 3
});

function cleanText(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function safeHttps(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}

function encodeCursor(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function decodeCursor(value) {
  if (!value) return {};
  if (typeof value !== "string" || value.length > 1500) {
    throw new Error("Invalid continuation cursor.");
  }
  const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid continuation cursor.");
  }
  const cursor = {};
  if (typeof parsed.continue === "string") cursor.continue = parsed.continue;
  if (typeof parsed.gsrcontinue === "string") cursor.gsrcontinue = parsed.gsrcontinue;
  return cursor;
}

async function handleMedia(req, res) {
  const rawQuery = req.method === "GET"
    ? req.query && req.query.q
    : req.body && req.body.q;
  const query = typeof rawQuery === "string" ? rawQuery.trim() : "";
  const typeValue = req.method === "GET"
    ? req.query && req.query.type
    : req.body && req.body.type;
  const type = typeValue === "video" ? "video" : typeValue === "image" ? "image" : "all";
  const rawCursor = req.method === "GET"
    ? req.query && req.query.cursor
    : req.body && req.body.cursor;

  res.setHeader && res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300");
  if (!query) return res.status(400).json({ ok: false, error: "Enter a topic to search Wikimedia Commons." });
  if (query.length > 160) return res.status(400).json({ ok: false, error: "Keep the media search under 160 characters." });

  let cursor;
  try {
    cursor = decodeCursor(rawCursor);
  } catch {
    return res.status(400).json({ ok: false, error: "Invalid search continuation. Start a new search." });
  }

  try {
    const response = await commons.get("https://commons.wikimedia.org/w/api.php", {
      params: {
        action: "query",
        generator: "search",
        gsrsearch: query,
        gsrnamespace: 6,
        gsrlimit: 24,
        prop: "imageinfo",
        iiprop: "url|size|mime|extmetadata",
        iiurlwidth: 720,
        ...cursor,
        format: "json",
        formatversion: 2
      }
    });

    const data = response.data || {};
    const pages = data.query && data.query.pages;
    const items = (Array.isArray(pages) ? pages : [])
      .map((page) => {
        const info = page.imageinfo && page.imageinfo[0];
        if (!info) return null;
        const mime = String(info.mime || "").toLowerCase();
        const mediaType = mime.startsWith("video/") ? "video" : mime.startsWith("image/") ? "image" : null;
        const originalUrl = safeHttps(info.url);
        const previewUrl = safeHttps(info.thumburl) || (mediaType === "image" ? originalUrl : null);
        if (!mediaType || !originalUrl || !previewUrl || (type !== "all" && type !== mediaType)) return null;
        const metadata = info.extmetadata || {};
        return {
          title: String(page.title || "").replace(/^File:/, ""),
          mediaType,
          mime,
          previewUrl,
          originalUrl,
          descriptionUrl: safeHttps(info.descriptionurl),
          width: Number(info.width) || null,
          height: Number(info.height) || null,
          artist: cleanText(metadata.Artist && metadata.Artist.value).slice(0, 180),
          license: cleanText((metadata.LicenseShortName && metadata.LicenseShortName.value) || (metadata.UsageTerms && metadata.UsageTerms.value)).slice(0, 100),
          attributionUrl: safeHttps(metadata.Attribution && metadata.Attribution.value)
        };
      })
      .filter(Boolean);

    const continuation = data.continue && typeof data.continue.gsrcontinue === "string"
      ? encodeCursor({ continue: data.continue.continue || "||", gsrcontinue: data.continue.gsrcontinue })
      : null;

    return res.status(200).json({
      ok: true,
      query,
      type,
      items,
      cursor: continuation,
      source: "Wikimedia Commons",
      notice: "Media is hosted on Wikimedia Commons, not uploaded to this website. Check each file's license and attribution before reuse."
    });
  } catch (error) {
    const status = error.response && error.response.status;
    console.error("Wikimedia Commons search failed:", { message: error.message, status });
    return res.status(502).json({ ok: false, error: "Wikimedia Commons could not complete the media search. Please try again." });
  }
}

module.exports = { handleMedia };
