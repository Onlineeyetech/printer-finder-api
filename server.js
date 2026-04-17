const cors = require("cors");
const express = require("express");
const fs = require("fs");
require("dotenv").config();
const axios = require("axios");
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const SCOPES = process.env.SCOPES;  
const REDIRECT_URI = "http://localhost:3000/auth/callback";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3000;
const SHOP = process.env.SHOP;
let ACCESS_TOKEN = process.env.ACCESS_TOKEN;

const DB = "./printers.json";

function readDB(){
return JSON.parse(fs.readFileSync(DB));
}

function saveDB(data){
fs.writeFileSync(DB, JSON.stringify(data,null,2));
}

function slug(str){
return str.toLowerCase().replace(/\s+/g,'-');
}

// add printer GET
app.get("/add-printer", async (req,res)=>{

const {brand,series,model} = req.query;

const data = readDB();

const printer = {
brand,
series,
model,
tag: `${slug(brand)}_${slug(series)}_${slug(model)}`
};

data.push(printer);

saveDB(data);

// create collection in Shopify
const title = `${brand} > ${series} Series > ${series} ${model}`;

try{

await axios.post(
`https://${SHOP}/admin/api/2024-10/smart_collections.json`,
{
smart_collection:{
title: title,
rules:[
{
column:"tag",
relation:"equals",
condition: printer.tag
}
]
}
},
{
headers:{
"X-Shopify-Access-Token": ACCESS_TOKEN,
"Content-Type":"application/json"
}
}
);

}
catch(e){
console.log("collection error");
console.log(e.response?.data);
}

res.json(printer);

});

// list printers
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

const existsModel = models[key].find(m => m.name === p.model);

if(!existsModel){
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

// auto sync



app.post("/webhook/collection-create", async (req,res)=>{

try{

const c = req.body;

const parts = c.title.split(">");

if(parts.length < 3){
return res.sendStatus(200);
}

const brand = parts[0].trim();
const series = parts[1].replace("Series","").trim();
const model = parts[2].replace(series,"").trim();

let existing = readDB();

const exists = existing.find(
p=>p.brand===brand && p.series===series && p.model===model
);

if(!exists){

existing.push({
brand,
series,
model,
tag: `${slug(brand)}_${slug(series)}_${slug(model)}`,
handle: c.handle
});

saveDB(existing);

console.log("Webhook synced:", c.title);

}

res.sendStatus(200);

}catch(e){

console.log("webhook error");
res.sendStatus(200);

}

});


app.get("/create-webhook", async (req,res)=>{

await axios.post(
`https://${SHOP}/admin/api/2024-10/webhooks.json`,
{
webhook:{
topic:"collections/create",
address: process.env.WEBHOOK_URL + "/webhook/collection-create",
format:"json"
}
},
{
headers:{
"X-Shopify-Access-Token": ACCESS_TOKEN,
"Content-Type":"application/json"
}
}
);

res.send("Webhook created");

});


app.listen(PORT,()=>{
console.log("server running on 3000");
});

app.get("/auth",(req,res)=>{

const installUrl = 
`https://${SHOP}/admin/oauth/authorize?client_id=${CLIENT_ID}&scope=${SCOPES}&redirect_uri=${REDIRECT_URI}`;

res.redirect(installUrl);

});
app.get("/sync-collections", async (req,res)=>{

try{

let existing = readDB();
let since_id = 0;

while(true){

const response = await axios.get(
`https://${SHOP}/admin/api/2024-10/smart_collections.json?limit=250&since_id=${since_id}`,
{
headers:{
"X-Shopify-Access-Token": ACCESS_TOKEN
}
}
);

const cols = response.data.custom_collections;

if(!cols.length) break;

cols.forEach(c=>{

const parts = c.title.split(">");

if(parts.length < 3) return;

const brand = parts[0].trim();
const series = parts[1].replace("Series","").trim();
const model = parts[2].replace(series,"").trim();

const tag = `${slug(brand)}_${slug(series)}_${slug(model)}`;

const exists = existing.find(
p=>p.brand===brand && p.series===series && p.model===model
);

if(!exists){
existing.push({
brand,
series,
model,
tag,
handle: c.handle
});
}

});

since_id = cols[cols.length-1].id;

}

saveDB(existing);

res.send("Synced all collections");

}catch(e){
console.log(e.response?.data);
res.send("Sync error");
}

});
app.get("/auth/callback", async (req,res)=>{

const {code} = req.query;

try{

const response = await axios.post(
`https://${SHOP}/admin/oauth/access_token`,
{
client_id: CLIENT_ID,
client_secret: CLIENT_SECRET,
code: code
},
{
headers:{
"Content-Type":"application/json"
}
}
);

ACCESS_TOKEN = response.data.access_token;

console.log("ACCESS TOKEN:");
console.log(ACCESS_TOKEN);

res.send("App connected successfully");

}catch(e){

console.log(e.response?.data || e.message);
res.send("OAuth failed");

}

});


