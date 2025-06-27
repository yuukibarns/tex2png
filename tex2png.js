#!/usr/bin/env -S npx node

const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");

// Get command-line arguments
const args = process.argv.slice(2);
if (args.length === 0 || args[0] === "help") {
  console.log(`Usage:
  tex2png stop                                          - Stop the server
  tex2png <input> [output] [color] [fontSize] [macros]  - Render formula
  tex2png help                                          - Show this help`);
  process.exit(0);
}

const command = args[0];
const PORT = 3000;

// Function to check if server is running
function checkServerRunning() {
  return new Promise((resolve) => {
    const req = http.request({
      hostname: "localhost",
      port: PORT,
      path: "/status",
      method: "GET",
      timeout: 200,
    }, (res) => {
      resolve(res.statusCode === 200);
    });

    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });

    req.end();
  });
}

function startServer(macrosFile) {
  console.log(macrosFile);
  return new Promise((resolve, reject) => {
    let server;
    const args = [path.join(__dirname, "tex2png-server.js"), "start"];
    if (macrosFile) args.push(macrosFile);

    try {
      server = spawn("node", args, {
        detached: true,
        stdio: "ignore",
      });

      server.unref();
      server.on("error", reject);

      setTimeout(() => {
        checkServerRunning().then((isRunning) => {
          if (isRunning) resolve();
          else {
            server.kill(); // Clean up if failed
            reject(new Error("Failed to start server"));
          }
        }).catch(reject);
      }, 1000);
    } catch (err) {
      reject(err);
    }
  });
}

if (command === "stop") {
  // Stop the server
  const server = spawn("node", [
    path.join(__dirname, "tex2png-server.js"),
    "stop",
  ]);

  server.stdout.on("data", (data) => {
    process.stdout.write(data);
  });

  server.stderr.on("data", (data) => {
    process.stderr.write(data);
  });
} else {
  // Handle render command
  (async () => {
    // Parse arguments with optional parameters
    let inputFile, outFile, color, fontSize, macrosFile;

    if (args.length >= 1) inputFile = path.resolve(args[0]);
    if (args.length >= 2) outFile = args[1];
    if (args.length >= 3) color = args[2];
    if (args.length >= 4) fontSize = args[3];
    if (args.length >= 5) macrosFile = path.resolve(args[4]);

    // Set defaults for optional parameters
    outFile = outFile || "output.png";
    color = color || "#8ec07c";
    fontSize = fontSize || 25;

    // Verify input file exists
    if (!fs.existsSync(inputFile)) {
      console.error(`Input file not found: ${inputFile}`);
      process.exit(1);
    }

    // Check if server is running, start if not
    const isRunning = await checkServerRunning();
    if (!isRunning) {
      try {
        console.log("Starting server...");
        if (macrosFile) {
          await startServer(macrosFile);
        } else {
          await startServer();
        }
      } catch (err) {
        console.error("Failed to start server:", err.message);
        process.exit(1);
      }
    }

    // Prepare request data (only include macros if specified)
    const requestData = {
      inputFile: inputFile,
      outFile: outFile,
      color: color,
      fontSize: fontSize,
    };

    const postData = JSON.stringify(requestData);

    // Send request to server
    const options = {
      hostname: "localhost",
      port: PORT,
      path: "/render",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData),
      },
    };

    const req = http.request(options, (res) => {
      let data = "";

      res.on("data", (chunk) => {
        data += chunk;
      });

      res.on("end", () => {
        if (res.statusCode === 200) {
          console.log(`Rendered to ${outFile}`);
        } else {
          try {
            const error = JSON.parse(data);
            console.error(`Error: ${error.error}`);
          } catch (e) {
            console.error(`Server error: ${res.statusCode}`);
          }
          process.exit(1);
        }
      });
    });

    req.on("error", (e) => {
      console.error(`Connection error: ${e.message}`);
      process.exit(1);
    });

    req.write(postData);
    req.end();
  })();
}
