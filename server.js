"use strict";

const express = require("express");
const axios = require("axios");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.disable("x-powered-by");
app.use(express.json({ limit: "10kb" }));

const LANGUAGES = new Set(["bn", "en"]);
const DETAILS = new Set(["short", "normal", "long"]);

const http = axios.create({
  timeout: 10000,
  headers: {
    "User-Agent": "WikiMasterBot/1.0 (educational Wikipedia search project; contact: site-owner)",
    Accept: "application/json"
  },
  maxRedirects: 3
});

function sendError(res, status, error, code) {
  return res.status(status).json({ ok: false, error, code });
}

function getDates() {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 29);
  const format = (date) =>
    date.getUTCFullYear().toString() +
    String(date.getUTCMonth() + 1).padStart(2, "0") +
    String(date.getUTCDate()).padStart(2, "0");
  return { start: format(start), end: format(end) };
}

function limitSummary(text, detail) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  const max = detail === "short" ? 650 : detail === "long" ? 5000 : 2000;
  if (clean.length <= max) return clean;
  const clipped = clean.slice(0, max);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, lastSpace > max * 0.85 ? lastSpace : max).trimEnd()}…`;
}

async function findArticle(message, lang) {
  const response = await http.get(`https://${lang}.wikipedia.org/w/api.php`, {
    params: {
      action: "query",
      list: "search",
      srsearch: message,
      srnamespace: 0,
      srlimit: 1,
      format: "json",
      formatversion: 2
    }
  });
  const results = response.data && response.data.query && response.data.query.search;
  return Array.isArray(results) && results.length ? results[0].title : null;
}

async function getArticleSummary(title, lang, detail) {
  const safeTitle = encodeURIComponent(title.replace(/ /g, "_"));
  const summaryUrl = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${safeTitle}`;
  const apiUrl = `https://${lang}.wikipedia.org/w/api.php`;

  const [summaryResult, detailsResult] = await Promise.allSettled([
    http.get(summaryUrl),
    http.get(apiUrl, {
      params: {
        action: "query",
        prop: "extracts|pageimages|links|info",
        titles: title,
        exintro: 1,
        exchars: detail === "short" ? 1000 : detail === "long" ? 6500 : 3000,
        explaintext: 1,
        explaintext: 1,
        piprop: "thumbnail|original",
        pithumbsize: 1200,
        plnamespace: 0,
        pllimit: 8,
        inprop: "url",
        redirects: 1,
        format: "json",
        formatversion: 2
      }
    })
  ]);

  const summary = summaryResult.status === "fulfilled" ? summaryResult.value.data || {} : {};
  const pages = detailsResult.status === "fulfilled" && detailsResult.value.data &&
    detailsResult.value.data.query && detailsResult.value.data.query.pages;
  const page = Array.isArray(pages) ? pages[0] || {} : {};
  const extract = typeof page.extract === "string" && page.extract.trim()
    ? page.extract.trim()
    : typeof summary.extract === "string" ? summary.extract.trim() : "";

  if (!extract) {
    if (summaryResult.status === "rejected") throw summaryResult.reason;
    throw new Error("Wikipedia returned an empty summary.");
  }

  const sourceUrl = (page.fullurl) ||
    (summary.content_urls && summary.content_urls.desktop && summary.content_urls.desktop.page) ||
    `https://${lang}.wikipedia.org/wiki/${safeTitle}`;
  const imageUrl = (page.original && page.original.source) ||
    (page.thumbnail && page.thumbnail.source) ||
    (summary.originalimage && summary.originalimage.source) ||
    (summary.thumbnail && summary.thumbnail.source) || null;
  const relatedLinks = Array.isArray(page.links)
    ? page.links.slice(0, 8).map((link) => ({
        title: link.title,
        url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(link.title.replace(/ /g, "_"))}`
      }))
    : [];

  return {
    title: page.title || summary.title || title,
    answer: extract,
    description: summary.description || "",
    sourceUrl,
    imageUrl,
    imageTitle: page.pageimage || "",
    relatedLinks
  };
}

async function getPageViews(title, lang) {
  try {
    const { start, end } = getDates();
    const safeTitle = encodeURIComponent(title.replace(/ /g, "_"));
    const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/${lang}.wikipedia/all-access/user/${safeTitle}/daily/${start}/${end}`;
    const response = await http.get(url);
    const items = response.data && response.data.items;
    if (!Array.isArray(items)) return null;
    const total = items.reduce((sum, item) => sum + (Number(item.views) || 0), 0);
    return { last30DaysViews: total, dailyAverage: Math.round(total / 30) };
  } catch {
    // Page-view statistics are optional and must not break an article search.
    return null;
  }
}

async function handleChat(req, res) {
  const body = req.body || {};
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const lang = LANGUAGES.has(body.lang) ? body.lang : "bn";
  const detail = DETAILS.has(body.detail) ? body.detail : "normal";

  if (!message) return sendError(res, 400, "একটি বিষয় লিখে সার্চ করো।", "EMPTY_QUERY");
  if (message.length > 200) {
    return sendError(res, 400, "সার্চের বিষয়টি ২০০ অক্ষরের মধ্যে রাখো।", "QUERY_TOO_LONG");
  }

  try {
    const matchedTitle = await findArticle(message, lang);
    if (!matchedTitle) {
      return sendError(
        res,
        404,
        "এই ভাষার Wikipedia-তে বিষয়টির কোনো মিল পাওয়া যায়নি। অন্য শব্দে চেষ্টা করো।",
        "ARTICLE_NOT_FOUND"
      );
    }

    const article = await getArticleSummary(matchedTitle, lang, detail);
    const analytics = await getPageViews(article.title, lang);

    return res.status(200).json({
      ok: true,
      title: article.title,
      answer: limitSummary(article.answer, detail),
      description: article.description,
      sourceUrl: article.sourceUrl,
      imageUrl: article.imageUrl,
      imageTitle: article.imageTitle,
      relatedLinks: article.relatedLinks,
      language: lang,
      analytics,
      creator: "Sayeef Adnan"
    });
  } catch (error) {
    const status = error.response && error.response.status;
    if (status === 404) {
      return sendError(res, 404, "নিবন্ধটি পাওয়া গেলেও তার সারাংশ আনা যায়নি। অন্য বিষয় দিয়ে চেষ্টা করো।", "SUMMARY_NOT_FOUND");
    }
    if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") {
      return sendError(res, 504, "Wikipedia থেকে উত্তর পেতে বেশি সময় লাগছে। কিছুক্ষণ পরে আবার চেষ্টা করো।", "UPSTREAM_TIMEOUT");
    }
    console.error("Wikipedia request failed:", { message: error.message, status });
    return sendError(res, 502, "Wikipedia সার্ভারে এই মুহূর্তে সমস্যা হচ্ছে। কিছুক্ষণ পরে আবার চেষ্টা করো।", "UPSTREAM_ERROR");
  }
}

app.post("/api/chat", handleChat);

app.get("/api/status", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ ok: true, service: "WikiMaster API", developer: "Sayeef Adnan" });
});

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));

app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    return sendError(res, 404, "API endpoint পাওয়া যায়নি।", "ROUTE_NOT_FOUND");
  }
  return res.status(404).type("text").send("Page not found.");
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`WikiMaster is running at http://localhost:${PORT}`));
}

module.exports = { app, handleChat };
