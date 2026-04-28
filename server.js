const express = require("express");
const cors = require("cors");
const fs = require("fs");
const axios = require("axios");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

const SHOP = process.env.best-toner-supply.myshopify.com; // example: yourstore.myshopify.com
const TOKEN = process.env.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;
const API_VERSION = "2024-01";

const headers = {
  "X-Shopify-Access-Token": TOKEN,
  "Content-Type": "application/json",
};

/*
========================================
SLEEP FUNCTION (RATE LIMIT FIX)
========================================
*/
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/*
========================================
FETCH ALL PAGES SAFELY
========================================
*/
async function fetchAllPages(endpoint) {
  let allData = [];
  let page = 1;
  let hasNextPage = true;

  while (hasNextPage) {
    try {
      console.log(`Fetching: ${endpoint} | page ${page}`);

      const url = `https://${SHOP}/admin/api/${API_VERSION}/${endpoint}.json?limit=250&page=${page}`;

      const response = await axios.get(url, { headers });

      const key = Object.keys(response.data)[0];
      const items = response.data[key] || [];

      allData = [...allData, ...items];

      console.log(`Fetched ${items.length} records`);

      if (items.length < 250) {
        hasNextPage = false;
      } else {
        page++;
      }

      /*
      IMPORTANT:
      Shopify rate limit safe delay
      */
      await sleep(700);

    } catch (error) {
      console.error(
        `Error fetching ${endpoint}:`,
        error.response?.data || error.message
      );

      /*
      Extra retry delay if rate limited
      */
      await sleep(2000);
      hasNextPage = false;
    }
  }

  return allData;
}

/*
========================================
SYNC COLLECTIONS ROUTE
========================================
*/
app.get("/sync-collections", async (req, res) => {
  try {
    console.log("Starting collection sync...");

    /*
    STEP 1:
    Fetch Smart Collections
    */
    const smartCollections = await fetchAllPages("smart_collections");

    /*
    STEP 2:
    Extra delay before next endpoint
    */
    await sleep(1000);

    /*
    STEP 3:
    Fetch Custom Collections
    */
    const customCollections = await fetchAllPages("custom_collections");

    /*
    STEP 4:
    Merge both collections
    */
    const allCollections = [
      ...smartCollections,
      ...customCollections,
    ];

    console.log(`Total collections fetched: ${allCollections.length}`);

    /*
    STEP 5:
    Format dropdown JSON
    */
    const formattedData = allCollections.map((collection) => ({
      id: collection.id,
      title: collection.title,
      handle: collection.handle,
    }));

    /*
    STEP 6:
    Save printers.json
    */
    fs.writeFileSync(
      "printers.json",
      JSON.stringify(formattedData, null, 2)
    );

    console.log("printers.json updated successfully");

    res.json({
      success: true,
      message: "Collections synced successfully",
      total: formattedData.length,
      data: formattedData,
    });

  } catch (error) {
    console.error(
      "Sync Error:",
      error.response?.data || error.message
    );

    res.status(500).json({
      success: false,
      error: error.response?.data || error.message,
    });
  }
});

/*
========================================
GET PRINTERS JSON ROUTE
========================================
*/
app.get("/printers", (req, res) => {
  try {
    const data = fs.readFileSync("printers.json", "utf8");
    res.json(JSON.parse(data));
  } catch (error) {
    res.status(500).json({
      error: "printers.json not found",
    });
  }
});

/*
========================================
ROOT
========================================
*/
app.get("/", (req, res) => {
  res.send("Printer Finder API Running");
});

/*
========================================
START SERVER
========================================
*/
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});