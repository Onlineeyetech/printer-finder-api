const cors = require("cors");
const express = require("express");
const fs = require("fs");
require("dotenv").config();
const axios = require("axios");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3000;

const SHOP = process.env.SHOP;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;

const DB = "./printers.json";

// ================= DB =================

function readDB(){
if(!fs.existsSync(DB)) return [];
return JSON.parse(fs.readFileSync(DB));
}

function saveDB(data){
fs.writeFileSync(DB, JSON.stringify(data,null,2));
}

function slug(str){
return str.toLowerCase().replace(/\s+/g,'-');
}

// ================= PARSER =================
function parseTitle(title){

title = title.trim();

let brand = "";
let series = "";
let model = "";

/* Case 1: Brand > Series > Model */
if(title.includes(">")){
const parts = title.split(">");

brand = parts[0]?.trim() || "";
series = parts[1]?.trim() || "";
model = parts[2]?.trim() || "";
}

/* Case 2: Normal title parsing */
else{

const words = title.split(/\s+/);

brand = words[0] || "";

/* Last word as probable model */
model = words[words.length - 1] || "";

/* Middle words = series */
series = words.slice(1, -1).join(" ").trim();

/* fallback */
if(!series){
series = "General";
}

/* cleanup */
series = series
.replace(/cartridges/gi,"")
.replace(/series/gi,"")
.replace(/printers/gi,"")
.replace(/toner/gi,"")
.replace(/ink/gi,"")
.trim();

if(!series){
series = "General";
}

}

return {
brand,
series,
model
};

}
// ================= FINDER =================

app.get("/finder",(req,res)=>{

const data = readDB();

const brands = [...new Set(data.map(p=>p.brand))];

const series = {};
const models = {};

data.forEach(p=>{

// series
if(!series[p.brand]) series[p.brand]=[];
if(!series[p.brand].includes(p.series))
series[p.brand].push(p.series);

// models
const key = p.brand+"__"+p.series;

if(!models[key]) models[key]=[];

const exists = models[key].find(m => m.name === p.model);

if(!exists){
models[key].push({
name: p.model,
handle: p.handle || ""
});
}

});

res.json({brands,series,models});

});

// ================= SYNC =================

app.get("/sync-collections", async (req,res)=>{

try{

let existing = [];
const headers = {
  "X-Shopify-Access-Token": ACCESS_TOKEN
};

let allCollections = [];

/* ================= SMART COLLECTIONS ================= */

let smartUrl = `https://${SHOP}/admin/api/2024-10/smart_collections.json?limit=250`;

while(smartUrl){

const response = await axios.get(smartUrl,{ headers });

const cols = response.data.smart_collections || [];
allCollections.push(...cols);

const link = response.headers.link;

if(link && link.includes('rel="next"')){
smartUrl = link.split(";")[0]
.replace("<","")
.replace(">","");
}else{
smartUrl = null;
}

}

/* ================= CUSTOM COLLECTIONS ================= */

let customUrl = `https://${SHOP}/admin/api/2024-10/custom_collections.json?limit=250`;

while(customUrl){

const response = await axios.get(customUrl,{ headers });

const cols = response.data.custom_collections || [];
allCollections.push(...cols);

const link = response.headers.link;

if(link && link.includes('rel="next"')){
customUrl = link.split(";")[0]
.replace("<","")
.replace(">","");
}else{
customUrl = null;
}

}

/* ================= SAVE DATA ================= */

console.log("TOTAL COLLECTIONS:", allCollections.length);

allCollections.forEach(c=>{

if(!c.title) return;

console.log("COLLECTION TITLE:", c.title);

const { brand, series, model } = parseTitle(c.title);

existing.push({
brand,
series,
model,
handle: c.handle || "",
tag: `${slug(brand)}_${slug(series)}_${slug(model)}`
});

});

console.log("TOTAL COLLECTIONS FROM SHOPIFY:", allCollections.length);
console.log("TOTAL TO SAVE:", existing.length);
console.log(existing.slice(0,10));

saveDB(existing);

console.log("FINAL SAVED:", existing.length);

res.send("Synced all collections");

}catch(e){

console.log("SYNC ERROR:", e.response?.data || e.message);
res.send(e.response?.data || e.message);

}

});

// ================= WEBHOOK =================

app.post("/webhook/collection-create", async (req,res)=>{

try{

const c = req.body;

if(!c.title) return res.sendStatus(200);

const {brand,series,model} = parseTitle(c.title);

let existing = readDB();

existing.push({
brand,
series,
model,
handle: c.handle,
tag: `${slug(brand)}_${slug(series)}_${slug(model)}`
});

saveDB(existing);

console.log("Webhook synced:", c.title);

res.sendStatus(200);

}catch(e){
console.log("webhook error");
res.sendStatus(200);
}

});

// ================= SERVER =================

app.listen(PORT,()=>{
console.log("Server running on port 3000");
});