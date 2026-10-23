const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// ব্র্যান্ডিং ও ডেভেলপার তথ্য (সাঈফ আদনান)
const DEVELOPER_INFO = {
  name: "সাঈফ আদনান (Sayeef Adnan)",
  role: "Lead Developer & Creator",
  botName: "WikiMaster AI Bot",
  poweredBy: "MediaWiki REST API, Action API & Analytics API"
};

// উইকিপিডিয়া নীতি অনুযায়ী ইউজার-এজেন্ট হেডার
const WIKI_HTTP_CLIENT = axios.create({
  headers: {
    'User-Agent': `WikiBotBySayeef/1.0 (https://github.com/sayeefadnan; contact: sayeef@example.com)`
  }
});

/**
 * ১. MediaWiki Action API: নিখুঁত আর্টিকেলের শিরোনাম (Title) অনুসন্ধান
 */
async function searchArticleTitle(query, lang = 'bn') {
  const actionApiUrl = `https://${lang}.wikipedia.org/w/api.php`;
  const params = {
    action: 'query',
    list: 'search',
    srsearch: query,
    format: 'json',
    utf8: 1,
    srlimit: 1
  };

  const response = await WIKI_HTTP_CLIENT.get(actionApiUrl, { params });
  const searchResults = response.data.query.search;

  if (!searchResults || searchResults.length === 0) {
    return null;
  }
  return searchResults[0].title;
}

/**
 * ২. MediaWiki REST API: নিবন্ধের সারসংক্ষেপ ও বিস্তারিত ডেটা এক্সট্র্যাক্ট
 */
async function getArticleSummary(title, lang = 'bn') {
  const encodedTitle = encodeURIComponent(title);
  const restApiUrl = `https://${lang}.wikipedia.org/w/rest.php/v1/page/${encodedTitle}/bare`;

  try {
    const response = await WIKI_HTTP_CLIENT.get(restApiUrl);
    return response.data;
  } catch (error) {
    // বিকল্প এন্ডপয়েন্ট
    const summaryUrl = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodedTitle}`;
    const response = await WIKI_HTTP_CLIENT.get(summaryUrl);
    return response.data;
  }
}

/**
 * ৩. Wikimedia Analytics API: গত ৩০ দিনের পেজ ভিউ বা এনালাইটিক্স ডেটা
 */
async function getPageAnalytics(title, lang = 'bn') {
  try {
    const now = new Date();
    const endDate = now.toISOString().slice(0, 10).replace(/-/g, '');
    
    const pastDate = new Date();
    pastDate.setDate(now.getDate() - 30);
    const startDate = pastDate.toISOString().slice(0, 10).replace(/-/g, '');

    const project = `${lang}.wikipedia.org`;
    const encodedTitle = encodeURIComponent(title);

    const analyticsUrl = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/${project}/all-access/user/${encodedTitle}/daily/${startDate}/${endDate}`;

    const response = await WIKI_HTTP_CLIENT.get(analyticsUrl);
    const items = response.data.items || [];
    
    const totalViews = items.reduce((sum, item) => sum + item.views, 0);
    return {
      monthlyViews: totalViews,
      averageDailyViews: items.length > 0 ? Math.round(totalViews / items.length) : 0
    };
  } catch (error) {
    return { monthlyViews: "ডেটা পাওয়া যায়নি", averageDailyViews: "N/A" };
  }
}

/**
 * চ্যাটবটের মূল এপিআই রুট
 */
app.post('/api/chat', async (req, res) => {
  const { message, lang = 'bn' } = req.body;

  if (!message) {
    return res.status(400).json({ error: "অনুগ্রহ করে কোনো প্রশ্ন বা বিষয় লিখুন।" });
  }

  try {
    // ধাপ ১: Action API দিয়ে শিরোনাম খোঁজা
    const matchedTitle = await searchArticleTitle(message, lang);

    if (!matchedTitle) {
      return res.json({
        botResponse: `দুঃখিত, আপনার খোঁজা "${message}" বিষয়টি সম্পর্কিত কোনো সঠিক নিবন্ধ উইকিপিডিয়ায় পাওয়া যায়নি।`,
        developer: DEVELOPER_INFO
      });
    }

    // ধাপ ২ ও ৩: প্যারালালে REST API এবং Analytics API কল করা
    const [summaryData, analyticsData] = await Promise.all([
      getArticleSummary(matchedTitle, lang),
      getPageAnalytics(matchedTitle, lang)
    ]);

    const description = summaryData.abstract || summaryData.extract || "বিস্তারিত তথ্য নিবন্ধের লিংকে রয়েছে।";
    const articleUrl = `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(matchedTitle)}`;

    // ফাইনাল রেসপন্স অবজেক্ট (ডেভেলপার ক্রেডিটসহ)
    const finalResponse = {
      query: message,
      matchedTitle: matchedTitle,
      answer: description,
      analytics: {
        last30DaysViews: analyticsData.monthlyViews,
        dailyAverage: analyticsData.averageDailyViews
      },
      sourceUrl: articleUrl,
      developerCredits: {
        createdByName: DEVELOPER_INFO.name,
        botName: DEVELOPER_INFO.botName,
        notice: `এই চ্যাটবটটি তৈরি করেছেন ${DEVELOPER_INFO.name}। powered by MediaWiki Combined APIs.`
      }
    };

    return res.json(finalResponse);

  } catch (error) {
    console.error("API Error:", error.message);
    return res.status(500).json({
      error: "তথ্য সংগ্রহ করতে একটি সমস্যা হয়েছে। আবার চেষ্টা করুন।",
      createdBy: DEVELOPER_INFO.name
    });
  }
});

// স্ট্যাটাস চেক রুট
app.get('/api/status', (req, res) => {
  res.json({
    status: "Running Successfully",
    createdBy: DEVELOPER_INFO.name,
    botName: DEVELOPER_INFO.botName,
    apis: ["Action API", "REST API", "Analytics API"]
  });
});

// লোকাল কম্পিউটারে টেস্ট করার জন্য (ভার্সেলে এটি স্বয়ংক্রিয়ভাবে নিষ্ক্রিয় থাকবে)
const PORT = process.env.PORT || 3000;
if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Server is running locally on port ${PORT}`);
    console.log(`Created by: ${DEVELOPER_INFO.name}`);
  });
}

// Vercel সার্ভারলেস ফাংশনের জন্য এক্সপোর্ট
module.exports = app;
