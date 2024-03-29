require("dotenv").config();
const cron = require("node-cron");
const express = require("express");
const fs = require("fs/promises");
const path = require("path");
const cheerio = require("cheerio");
const resend = require("resend");

/* From nginx's perspective, let's
    redirect all requests to /articles to this server

    and then we need routes for:
    - fetching all existing data
    - adding a new article
    - marking an article as finished
    - removing an article
*/

const getMetaData = async (url) => {
  const data = await fetch(url);
  const html = await data.text();
  const $ = cheerio.load(html);
  const title = $("title").text();
  const description = $('meta[name="description"]').attr("content");
  const ogTitle = $('meta[property="og:title"]').attr("content");
  const ogDescription = $('meta[property="og:description"]').attr("content");

  return {
    title: title ?? ogTitle ?? "",
    description: description ?? ogDescription ?? "",
  };
};

const resendService = new resend.Resend(process.env.RESEND_API_KEY);

const db = path.resolve(__dirname, "db/articles.json");

const app = express();

app.use(express.json());

app.get("/articles", async (req, res) => {
  if (req.query.new) {
    console.log("new: ", req.query.new);
    const newUrl = req.query.new;
    const data = await fs.readFile(db, "utf-8");
    const dataObj = JSON.parse(data);
    if (!dataObj.articles) {
      dataObj.articles = [];
    }
    dataObj.articles.push(newUrl);

    await fs.writeFile(db, JSON.stringify(dataObj));
    return res.send("Article added successfully");
  } else {
    const data = await fs.readFile(db, "utf-8");
    res.send(data);
  }
});

const sendEmail = async () => {
  const data = await fs.readFile(db, "utf-8");
  const dataObj = JSON.parse(data);

  if (dataObj.articles.length === 0) {
    console.log("Nothing to send");
    await resendService.emails.send({
      from: "send@read-your-articles.lol",
      to: ["ishaqibrahibss@gmail.com"],
      subject: "Nothing more to read",
      text: "You've finished reading all of your articles. Add more to your list to get some suggestions!",
    });
    return;
  }

  const randomlySelectedArticle =
    dataObj.articles[Math.floor(Math.random() * dataObj.articles.length)];

  const { title, description } = await getMetaData(randomlySelectedArticle);

  const html = `<h3>Try this one out for today:</h3>
  <p><a href="${randomlySelectedArticle}">${
    title ?? randomlySelectedArticle
  }</a></p>
  <p>${description}</p>
    <p><a href="http://isquare.lol/articles/finished?url=${randomlySelectedArticle}">Click here if you've finished this one, so that it's not suggested again.</a></p>
      `;

  console.log(
    "Sending email for ",
    randomlySelectedArticle,
    " at ",
    new Date().toLocaleString()
  );

  await resendService.emails.send({
    from: "send@read-your-articles.lol",
    to: ["ishaqibrahimbss@gmail.com"],
    subject: "From your reading list",
    html: html,
  });
  return;
};

app.get("/articles/finished", async (req, res) => {
  const url = req.query.url;

  if (!url) {
    return res.send("No URL provided");
  }

  const dbData = await fs.readFile(db, "utf-8");
  const dataObj = JSON.parse(dbData);
  if (!dataObj.finished) {
    dataObj.finished = [];
  }

  dataObj.articles = dataObj.articles.filter(
    (articleUrl) => articleUrl !== url
  );

  dataObj.finished.push(url);

  await fs.writeFile(db, JSON.stringify(dataObj));

  return res.send("Article marked as finished");
});

const server = require("http").createServer(app);

// UTC time cause that's what the server uses
cron.schedule("0 5 * * *", () => {
  sendEmail();
});

server.listen(3000, () => console.log("Server is running on port 3000"));
