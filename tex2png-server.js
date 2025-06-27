#!/usr/bin/env -S npx node

const fs = require("fs");
const path = require("path");
const { Resvg } = require("@resvg/resvg-js");
const express = require("express");
const bodyParser = require("body-parser");

const app = express();
app.use(bodyParser.json());

// Get command-line arguments
const args = process.argv.slice(2);

// Default settings
const defaultColor = "#8ec07c";
const defaultFontSize = 30;
const PID_FILE = path.join(__dirname, "tex2png-server.pid");
const PORT = 3000;

// Default macros
const defaultMacros = {
  // HACK(yuukibarns): MathJax's limits
  bm: ["\\boldsymbol{#1}", 1],
  tag: ["\\qquad (\\mathrm{#1})", 1],
};

// Command handling
const command = args[0];

if (command === "start") {
  if (args.length >= 2) startServer(args[1]);
  else startServer();
} else if (command === "stop") {
  stopServer();
} else {
  console.log("Usage: tex2png-server.js [start|stop]");
  process.exit(1);
}

function startServer(macrosFile) {
  // Check if already running
  if (fs.existsSync(PID_FILE)) {
    const pid = parseInt(fs.readFileSync(PID_FILE, "utf8"));
    try {
      process.kill(pid, 0);
      console.log(`Server already running with PID ${pid}`);
      return;
    } catch (e) {
      // Process not running, continue
      fs.unlinkSync(PID_FILE);
    }
  }

  // Load macros if specified
  let customMacros;
  if (macrosFile) {
    try {
      if (!fs.existsSync(macrosFile)) {
        console.error(`Macros file not found: ${macrosFile}`);
        process.exit(1);
      }
      customMacros = JSON.parse(fs.readFileSync(macrosFile, "utf8"));
    } catch (err) {
      console.error(`Error loading macros file: ${err.message}`);
      process.exit(1);
    }
  }

  // Initialize MathJax and start server
  require("mathjax").init({
    loader: {
      load: [
        "input/tex-base",
        "[tex]/noundefined",
        "[tex]/configmacros",
        "[tex]/ams",
        "[tex]/mathtools",
        "[tex]/boldsymbol",
        "output/svg",
      ],
    },
    tex: {
      packages: [
        "base",
        "noundefined",
        "configmacros",
        "ams",
        "mathtools",
        "boldsymbol",
      ],
      macros: { ...defaultMacros, ...customMacros }, // Start with default macros
    },
  }).then(async (MathJax) => {
    console.log("MathJax initialized, starting server...");

    // Add status endpoint
    app.get("/status", (req, res) => {
      res.status(200).send("OK");
    });

    app.post("/render", async (req, res) => {
      try {
        const {
          inputFile,
          outFile = "output.png",
          color = defaultColor,
          fontSize = defaultFontSize,
        } = req.body;

        if (!inputFile) {
          return res.status(400).json({ error: "inputFile is required" });
        }

        // Read content from file
        let content;
        try {
          content = fs.readFileSync(inputFile, "utf8").trim();
        } catch (err) {
          return res.status(400).json({
            error: `Error reading input file: ${err.message}`,
          });
        }

        const { content: mathContent, display } = processMathContent(content);

        // Convert to SVG
        const svg = MathJax.tex2svg(mathContent, { display });
        const innerSVG = MathJax.startup.adaptor.firstChild(svg);
        MathJax.startup.adaptor.setAttribute(innerSVG, "color", color);
        const svgString = MathJax.startup.adaptor.outerHTML(innerSVG);

        // Convert to PNG
        const opts = {
          font: {
            loadSystemFonts: false,
            defaultFontFamily: "Latin Modern Math",
            defaultFontSize: Number(fontSize) + (display ? 5 : 0),
          },
        };

        const resvg = new Resvg(svgString, opts);
        const pngData = resvg.render();
        const pngBuffer = pngData.asPng();

        fs.writeFileSync(outFile, pngBuffer);
        res.json({ success: true, file: outFile });
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
      }
    });

    const server = app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      // Write PID file
      fs.writeFileSync(PID_FILE, process.pid.toString());
    });

    // Handle graceful shutdown
    process.on("SIGINT", () => {
      server.close(() => {
        if (fs.existsSync(PID_FILE)) {
          fs.unlinkSync(PID_FILE);
        }
        console.log("Server stopped");
        process.exit(0);
      });
    });
  }).catch((err) => {
    console.error(`MathJax initialization failed: ${err.message}`);
    process.exit(1);
  });
}

function stopServer() {
  if (!fs.existsSync(PID_FILE)) {
    console.log("Server is not running");
    return;
  }

  const pid = parseInt(fs.readFileSync(PID_FILE, "utf8"));
  try {
    process.kill(pid, "SIGINT");
    console.log(`Sent stop signal to server (PID ${pid})`);
  } catch (err) {
    console.log(`Server not running (PID ${pid})`);
    fs.unlinkSync(PID_FILE);
  }
}

function processMathContent(content) {
  const isDisplayMath = content.startsWith("$$") && content.endsWith("$$") ||
    content.startsWith("\\[") && content.endsWith("\\]");

  const isInlineMath = content.startsWith("$") && content.endsWith("$") ||
    content.startsWith("\\(") && content.endsWith("\\)");

  let cleanedContent = content;
  let displayMode = false;

  if (isDisplayMath) {
    displayMode = true;
    if (content.startsWith("$$")) {
      cleanedContent = content.slice(2, -2).trim();
    } else {
      cleanedContent = content.slice(2, -2).trim();
    }
  } else if (isInlineMath) {
    displayMode = false;
    if (content.startsWith("$")) {
      cleanedContent = content.slice(1, -1).trim();
    } else {
      cleanedContent = content.slice(2, -2).trim();
    }
  } else {
    console.log(
      "No recognized math delimiters found, treating as display math",
    );
    displayMode = true;
  }

  return {
    content: cleanedContent,
    display: displayMode,
  };
}
