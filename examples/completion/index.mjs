#!/usr/bin/env node

import http from "http";

const APP_HOST = process.env.APP_HOST || "localhost";
const APP_PORT = process.env.APP_PORT || 35729;

const requestListener = function (req, res) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/plain");
  res.end("Hello world!\n");
};

function main() {
  const server = http.createServer(requestListener);
  server.listen(APP_PORT, APP_HOST, () => {
    console.log(`Server is running on http://${APP_HOST}:${APP_PORT}`);
  });
}

try {
  main();
} catch (err) {
  console.error("Error", err);
}
