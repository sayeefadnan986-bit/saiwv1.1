
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
    "User-Agent":
      "WikiMasterBot/1.0 (educational Wikipedia search project; contact: site-owner)",
    "Accept": "application/json"
  },
  maxRedirects: 3
});

function sendError(res, status, error, code) {
  return res.status(status).json({
    ok: false,
    error,
    code
  });
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
  const clean = String(text || "").trim();
  if (detail === "short") return clean.slice(0, 500);
  if (detail === "long") return clean.slice(0, 3500);
  return clean.slice(0, 1500);
}

async function findArticle(message, lang) {
  const endpoint = `https://${lang}.wikipedia.org/w/api.php`;

  const response = await http.get(endpoint, {
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

  const results = response.data &&
    response.data.query &&
    response.data.query.search;

  if (!Array.isArray(results) || results.length === 0) {
    return null;
  }

  return results[0].title;
}

async function getArticleSummary(title, lang) {
  const safeTitle = encodeURIComponent(title.replace(/ /g, "_"));
  const endpoint =
    `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${safeTitle}`;

  const response = await http.get(endpoint);
  const data = response.data || {};

  const extract = typeof data.extract === "string"
    ? data.extract.trim()
    : "";

  if (!extract) {
    throw new Error("Wikipedia returned an empty summary.");
  }

  const sourceUrl =
    data.content_urls &&
    data.content_urls.desktop &&
    data.content_urls.desktop.page;

  return {
    title: data.title || title,
    answer: extract,
    sourceUrl: sourceUrl ||
      `https://${lang}.wikipedia.org/wiki/${safeTitle}`
  };
}

async function getPageViews(title, lang) {
  try {
    const { start, end } = getDates();
    const safeTitle = encodeURIComponent(title.replace(/ /g, "_"));
    const project = `${lang}.wikipedia`;

    const url =
      `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/` +
      `${project}/all-access/user/${safeTitle}/daily/${start}/${end}`;

    const response = await http.get(url);
    const items = response.data && response.data.items;

    if (!Array.isArray(items)) return null;

    const total = items.reduce(
      (sum, item) => sum + (Number(item.views) || 0),
      0
    );

    return {
      last30DaysViews: total,
      dailyAverage: Math.round(total / 30)
    };
  } catch {
    // Statistics are optional; a failure here must not break the search.
    return null;
  }
}

async function handleChat(req, res) {
  const body = req.body || {};
  const message = typeof body.message === "string"
    ? body.message.trim()
    : "";

  const lang = LANGUAGES.has(body.lang) ? body.lang : "bn";
  const detail = DETAILS.has(body.detail) ? body.detail : "normal";

  if (!message) {
    return sendError(res, 400, "একটি বিষয় লিখে সার্চ করো।", "EMPTY_QUERY");
  }

  if (message.length > 200) {
    return sendError(
      res,
      400,
      "সার্চের বিষয়টি ২০০ অক্ষরের মধ্যে রাখো।",
      "QUERY_TOO_LONG"
    );
  }

  try {
    const matchedTitle = await findArticle(message, lang);

    if (!matchedTitle) {
      return sendError(
        res,
        404,
        "এই ভাষার Wikipedia-তে বিষয়টির কোনো মিল পাওয়া যায়নি। অন্য শব্দে চেষ্টা করো অথবা ভাষা পরিবর্তন করো।",
        "ARTICLE_NOT_FOUND"
      );
    }

    const article = await getArticleSummary(matchedTitle, lang);
    const analytics = await getPageViews(article.title, lang);

    return res.status(200).json({
      ok: true,
      title: article.title,
      answer: limitSummary(article.answer, detail),
      sourceUrl: article.sourceUrl,
      language: lang,
      analytics,
      developer: "Sayeef Adnan"
    });
  } catch (error) {
    const status = error.response && error.response.status;

    if (status === 404) {
      return sendError(
        res,
        404,
        "নিবন্ধটি পাওয়া গেলেও তার সারাংশ আনা যায়নি। অন্য বিষয় দিয়ে চেষ্টা করো।",
        "SUMMARY_NOT_FOUND"
      );
    }

    if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") {
      return sendError(
        res,
        504,
        "Wikipedia থেকে উত্তর পেতে বেশি সময় লাগছে। কিছুক্ষণ পরে আবার চেষ্টা করো।",
        "UPSTREAM_TIMEOUT"
      );
    }

    console.error("Wikipedia request failed:", {
      message: error.message,
      status
    });

    return sendError(
      res,
      502,
      "Wikipedia সার্ভারে এই মুহূর্তে সমস্যা হচ্ছে। কিছুক্ষণ পরে আবার চেষ্টা করো।",
      "UPSTREAM_ERROR"
    );
  }
}

// Shared handler used by Vercel's api/chat.js.
app.post("/api/chat", handleChat);

app.get("/api/status", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({
    ok: true,
    service: "WikiMaster API",
    developer: "Sayeef Adnan"
  });
});

// Local development: serve the frontend from the project root.
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    return sendError(res, 404, "API endpoint পাওয়া যায়নি।", "ROUTE_NOT_FOUND");
  }

  return res.status(404).type("text").send("Page not found.");
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`WikiMaster is running at http://localhost:${PORT}`);
  });
}

module.exports = { app, handleChat };
