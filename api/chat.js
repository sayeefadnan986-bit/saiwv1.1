
"use strict";

const { handleChat } = require("../server");

module.exports = function handler(req, res) {
  // Add Express-compatible helpers when running on Vercel's Node response.
  if (typeof res.status !== "function") {
    res.status = function (code) {
      res.statusCode = code;
      return res;
    };
  }

  if (typeof res.json !== "function") {
    res.json = function (data) {
      if (!res.headersSent) {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
      }
      res.end(JSON.stringify(data));
      return res;
    };
  }

  return handleChat(req, res);
};
