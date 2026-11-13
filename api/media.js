"use strict";

const { handleMedia } = require("../media-search");

module.exports = function handler(req, res) {
  if (typeof res.status !== "function") {
    res.status = function (code) {
      res.statusCode = code;
      return res;
    };
  }

  if (typeof res.json !== "function") {
    res.json = function (data) {
      if (!res.headersSent) res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify(data));
      return res;
    };
  }

  return handleMedia(req, res);
};
