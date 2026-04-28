const cors = require("cors");
const express = require("express");
const fs = require("fs");
require("dotenv").config();
const axios = require("axios");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

const SHOP = process.env.SHOP;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;

const DB = "./printers.json";

/* =========================
   DB HELPERS
========================= */

function readDB() {
  if (!fs.existsSync(DB)) return [];
  try {
    return JSON.parse(fs.readFileSync(DB, "utf8"));
  } catch {
    return [];
  }
}

function saveDB(data) {
  fs.writeFileSync(DB, JSON.stringify(data, null, 2));
}

function slug(str = "") {
  return String(str)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\-]/g, "")
    .replace(/-+/g, "-");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* =========================
   TITLE PARSER
========================= */

function parseTitle(title = "") {
  title = String(title).trim();

  if (!title) {
    return null;
  }

  let brand = "";
  let series = "";
  let model = "";

  /* Case 1: Brand > Series > Model */
  if (title.includes(">")) {
    const parts = title.split(">");

    brand = (parts[0] || "").trim();
    series = (parts[1] || "").trim();
    model = (parts[2] || "").trim();
  }

  /* Case 2: Normal title */
  else {
    const words = title.split(/\s+/).filter(Boolean);

    if (words.length < 2) return null;

    brand = words[0] || "";
    model = words[words.length - 1] || "";
    series = words.slice(1, -1).join(" ").trim();

    /* cleanup */
    series = series
      .replace(/cartridges/gi, "")
      .replace(/cartridge/gi, "")
      .replace(/printers/gi, "")
      .replace(/printer/gi, "")
      .replace(/toner/gi, "")
      .replace(/ink/gi, "")
      .replace(/series/gi, "")
      .replace(/drum/gi, "")
      .replace(/unit/gi, "")
      .trim();

    if (!series) {
      series = "General";
    }
  }

  /* validation */
  if (!brand || !model) {
    return null;
  }

  /* junk filters */
  const badWords = [
    "cartridge",
    "cartridges",
    "ink",
    "toner",
    "printer",
    "printers",
    "drum"
  ];

  if (badWords.includes(model.toLowerCase())) {
    return null;
  }

  return {
    brand,
    series,
    model
  };
}

/* =========================
   FINDER API
========================= */

app.get("/finder", (req, res) => {
  const data = readDB();

  const cleanData = data.filter(
    (p) => p.brand && p.series && p.model
  );

  const brands = [
    ...new Set(cleanData.map((p) => p.brand))
  ].sort();

  const series = {};
  const models = {};

  cleanData.forEach((p) => {
    /* series */
    if (!series[p.brand]) {
      series[p.brand] = [];
    }

    if (!series[p.brand].includes(p.series)) {
      series[p.brand].push(p.series);
    }

    /* models */
    const key = `${p.brand}__${p.series}`;

    if (!models[key]) {
      models[key] = [];
    }

    const exists = models[key].find(
      (m) => m.name === p.model
    );

    if (!exists) {
      models[key].push({
        name: p.model,
        handle: p.handle || ""
      });
    }
  });

  res.json({
    brands,
    series,
    models
  });
});

/* =========================
   SYNC COLLECTIONS
========================= */

app.get("/sync-collections", async (req, res) => {
  try {
    let existing = [];
    let allCollections = [];

    const headers = {
      "X-Shopify-Access-Token": ACCESS_TOKEN
    };

    /* SMART COLLECTIONS */

    let smartUrl = `https://${SHOP}/admin/api/2024-10/smart_collections.json?limit=250`;

    while (smartUrl) {
      const response = await axios.get(smartUrl, {
        headers
      });

      const cols = response.data.smart_collections || [];
      allCollections.push(...cols);

      const link = response.headers.link;

      if (link && link.includes('rel="next"')) {
        smartUrl = link
          .split(";")[0]
          .replace("<", "")
          .replace(">", "");
      } else {
        smartUrl = null;
      }

      await sleep(2500);
    }

    /* CUSTOM COLLECTIONS */

    let customUrl = `https://${SHOP}/admin/api/2024-10/custom_collections.json?limit=250`;

    while (customUrl) {
      const response = await axios.get(customUrl, {
        headers
      });

      const cols = response.data.custom_collections || [];
      allCollections.push(...cols);

      const link = response.headers.link;

      if (link && link.includes('rel="next"')) {
        customUrl = link
          .split(";")[0]
          .replace("<", "")
          .replace(">", "");
      } else {
        customUrl = null;
      }

      await sleep(2500);
    }

    console.log("TOTAL COLLECTIONS:", allCollections.length);

    const uniqueMap = new Map();

    allCollections.forEach((c) => {
      if (!c.title) return;

      const parsed = parseTitle(c.title);

      if (!parsed) return;

      const { brand, series, model } = parsed;

      const uniqueKey = `${brand}__${series}__${model}`;

      if (!uniqueMap.has(uniqueKey)) {
        uniqueMap.set(uniqueKey, {
          brand,
          series,
          model,
          handle: c.handle || "",
          tag: `${slug(brand)}_${slug(series)}_${slug(model)}`
        });
      }
    });

    existing = Array.from(uniqueMap.values());

    console.log("FINAL SAVED:", existing.length);

    saveDB(existing);

    res.send("Synced all collections");
  } catch (e) {
    console.log(
      "SYNC ERROR:",
      e.response?.data || e.message
    );

    res.status(500).send(
      e.response?.data || e.message
    );
  }
});

/* =========================
   WEBHOOK
========================= */

app.post("/webhook/collection-create", (req, res) => {
  try {
    const c = req.body;

    if (!c.title) {
      return res.sendStatus(200);
    }

    const parsed = parseTitle(c.title);

    if (!parsed) {
      return res.sendStatus(200);
    }

    const { brand, series, model } = parsed;

    let existing = readDB();

    const alreadyExists = existing.find(
      (p) =>
        p.brand === brand &&
        p.series === series &&
        p.model === model
    );

    if (!alreadyExists) {
      existing.push({
        brand,
        series,
        model,
        handle: c.handle || "",
        tag: `${slug(brand)}_${slug(series)}_${slug(model)}`
      });

      saveDB(existing);
    }

    console.log("Webhook synced:", c.title);

    res.sendStatus(200);
  } catch (e) {
    console.log("WEBHOOK ERROR:", e.message);
    res.sendStatus(200);
  }
});

/* =========================
   ROOT
========================= */

app.get("/", (req, res) => {
  res.send("Printer Finder API Running");
});

/* =========================
   SERVER
========================= */

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});