#!/usr/bin/env node

import chalk from "chalk";
import connectLivereload from "connect-livereload";
import { createHash } from "crypto";
import express from "express";
import { createWriteStream, watch } from "fs";
import fs from "fs/promises";
import livereload from "livereload";
import { OpenAIChatMessage, ollama, openai, streamText } from "modelfusion";
import path from "path";
import { fileURLToPath } from "url";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Environment variables and constants
const {
  JENNGEN_LIVERELOAD_PORT: LIVERELOAD_PORT = 35729,
  JENNGEN_PORT: SERVER_PORT = 3000,
  JENNGEN_DIST: DIST_DIR = ".dist",
  JENNGEN_INSTRUCTIONS: INSTRUCTION_FILE = ".jenngen",
  JENNGEN_CACHE: CACHE_DIR = ".jenngen_cache",
  JENNGEN_MODEL: JENNGEN_MODEL = "gpt-4-1106-preview", // or "gpt-3.5-turbo"
  JENNGEN_OLLAMA_MODEL: JENNGEN_OLLAMA_MODEL = null,
} = process.env;

const ASSISTANT_PROMPT = `You are JennGen, an AI-driven static site generator. Your role is to convert provided pseudo-code or instructions into high-quality, deployable code, tailored to the file name and content specifications. The output should be similar to a $150,000 website from a top-tier web development agency using the latest development practices.

Input File Content Rules:
- Mixed Content Types: Inputs may include combinations such as markdown with JavaScript, or prose with CSS, or instruction text mixed with literal quotes.
- Literal Text: Text within double quotes ("") should be used exactly as is. For instance, "This is my description" translates directly into "This is my description".
- Dynamic Placeholders: Text within curly braces ({}) represents dynamic variables. Replace {title} with the actual title of the page or other relevant content.
- Instructional Text: Text within square brackets ([]) contains instructions to generate specific content. For example, [Insert a random number] should be replaced with an actual random number, and [Insert marketing copy here] should be replaced with professional marketing content.
- Interactive Elements: Text within angle brackets (<>) should be replaced with interactive or real-time content. E.g., <Ask the user for their name> becomes a user input prompt for their name, and <clock with current time> becomes a live JavaScript clock showing the current time.
- Professional Standard: All generated content should be professional-grade, appropriate for the file type, and devoid of any pseudo-code or placeholders.
- No Filler Content: Avoid using "lorem ipsum", emojis, or similar filler material, unless explicitly requested.
- If the input file looks complete, instead of like pseudo code, make it better.

Output File Specifications:
- Language Match: Output code should correspond to the file extension (e.g., .html for HTML, .js for JavaScript, .tf for Terraform).
- Text Quality: Ensure correct capitalization, spelling, and grammar.
- HTML Styling: Use style tags, inline CSS, and Tailwind (CDN: https://cdn.tailwindcss.com).
- HTML Quality: The webpage should be responsive, support dark mode, have good accessibility, and semantic HTML for SEO.
- Dynamic JavaScript: Implement interactive or dynamic content as needed using consise, idiomatic JavaScript.
- Deployment-Ready: All output code must be functional and ready for website deployment.
- Pure Code Output: Provide only the code output, without markdown code blocks or explanatory prose.
- Design Quality: The output should feature an attractive, high-quality design with consistent styling across pages.
- Output should contain any other relevant code to make it functional, even if it does not directly correspond to the input file. For example, add imports, global variables, or other code as needed.
- Output should never mention the system instructions or pseudo-code.
- If the input is not understood, say "400: Bad Request. Please check the input file.".
- Ensure the output is purely the relevant code, devoid of wrapping markdown code blocks (eg. "\`\`\`language\n") or explanatory prose.

User Instructions for the Website:
<<<INSTRUCTIONS>>>

Current Folder Files:
<<<FILES>>>

Pseudo-Code Input Examples:
<<<INPUT>>>

Real Code Output Examples:
<<<OUTPUT>>>`;
const USER_PROMPT = `Based on the provided pseudo-code, generate the corresponding code.\n`;
const FILE_PROMPT = `FILE: <<<FILENAME>>>\nCONTENTS: <<<CONTENTS>>>`;

async function hasFileChanged(sourceFolder, file) {
  const hash = createHash("sha256")
    .update(JENNGEN_MODEL + JENNGEN_OLLAMA_MODEL + file.content)
    .digest("hex");
  const cacheFilePath = path.join(
    sourceFolder,
    CACHE_DIR,
    file.path.replace(/\//g, "_")
  );
  try {
    const storedHash = await fs.readFile(cacheFilePath, "utf-8");
    return hash !== storedHash;
  } catch (error) {
    return true; // File not in cache or other error
  }
}

async function updateCache(sourceFolder, file) {
  const hash = createHash("sha256")
    .update(JENNGEN_MODEL + JENNGEN_OLLAMA_MODEL + file.content)
    .digest("hex");
  const cacheFilePath = path.join(
    sourceFolder,
    CACHE_DIR,
    file.path.replace(/\//g, "_")
  );
  await fs.writeFile(cacheFilePath, hash, "utf-8");
}

// Get a tree of files and folders, their names and contents
async function getFiles(folder) {
  const entries = await fs.readdir(folder, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      if (entry.name === DIST_DIR) return null;
      if (entry.name === CACHE_DIR) return null;
      if (entry.name === INSTRUCTION_FILE) return null;
      if (entry.name === "node_modules") return null;
      if (entry.name === ".git") return null;
      if (entry.name === ".gitignore") return null;
      if (entry.name === ".DS_Store") return null;
      if (entry.name === ".env") return null;

      const path = `${folder}/${entry.name}`;
      if (entry.isDirectory()) {
        return getFiles(path); // Recursive call for directories
      } else if (entry.isFile()) {
        const content = await fs.readFile(path, "utf-8");
        return { name: entry.name, path, content };
      }
    })
  );

  return files.flat().filter(Boolean); // Flatten and filter out null values
}

async function completion(assistant, prompt) {
  if (JENNGEN_OLLAMA_MODEL) {
    return await streamText(
      ollama
        .CompletionTextGenerator({
          model: JENNGEN_OLLAMA_MODEL,
          temperature: 0.3,
          top_p: 1,
          system: assistant,
        })
        .withTextPrompt(),
      prompt
    );
  }

  return await streamText(
    openai.ChatTextGenerator({
      model: JENNGEN_MODEL,
      temperature: 0.3,
      top_p: 1,
    }),
    [OpenAIChatMessage.assistant(assistant), OpenAIChatMessage.user(prompt)]
  );
}

// Get a tree of files and folders, their names and contents
async function getExamples(folder, extension) {
  const files = await fs.readdir(folder, { withFileTypes: true });
  const promises = files.flatMap(async (file) => {
    const filePath = path.join(folder, file.name);
    if (file.isDirectory()) {
      return getExamples(filePath, extension);
    } else if (file.isFile() && file.name.endsWith(extension)) {
      const content = await fs.readFile(filePath, "utf-8");
      return { name: file.name, path: filePath, content };
    }
  });
  const results = await Promise.all(promises);
  return results.flat().filter(Boolean);
}

function applyFile(prompt, filename, content) {
  return prompt
    .replace("<<<FILENAME>>>", filename)
    .replace("<<<CONTENTS>>>", content);
}

// add prompt and completion examples:
// - examples/prompt/index.html
// - examples/completion/index.html
// - examples/prompt/about.html
// - examples/completion/about.html
//
// <<<INPUT>>> and <<<OUTPUT>>> turn into:
// FILENAME: index.html
// CONTENTS: [content goes here...]
// FILENAME: about.html
// CONTENTS: [content goes here...]
function applyExamples(prompt, examples) {
  let inputs = [];
  let outputs = [];
  for (const example of examples) {
    console.log(`Applying example ${example.path}`);
    if (example.path.includes("examples/prompt")) {
      inputs.push(applyFile(FILE_PROMPT, example.path, example.content));
    } else if (example.path.includes("examples/completion")) {
      outputs.push(applyFile(FILE_PROMPT, example.path, example.content));
    }
  }
  return prompt
    .replace("<<<INPUT>>>", inputs.join("\n"))
    .replace("<<<OUTPUT>>>", outputs.join("\n"));
}

async function generateCode(
  sourceFolder,
  assistantPrompt,
  file,
  liveReloadServer = null,
  force = false
) {
  if (!file) return;
  if (!(await hasFileChanged(sourceFolder, file)) && !force) return;

  console.log(chalk.yellow(`Generating ${file.name}`));

  const fileExtension = file.path.split(".").pop();
  const examples = await getExamples(
    path.join(__dirname, "examples"),
    fileExtension
  );

  const renderedAssistantPrompt = applyExamples(assistantPrompt, examples);
  const userPrompt = applyFile(FILE_PROMPT, file.name, file.content);

  const completionStream = await completion(
    renderedAssistantPrompt,
    USER_PROMPT + userPrompt
  );

  const relativeFilePath = path.relative(sourceFolder, file.path);
  const distPath = path.join(sourceFolder, DIST_DIR, relativeFilePath);

  // create folder if it doesn't exist
  await fs.mkdir(path.dirname(distPath), { recursive: true });
  await fs.writeFile(distPath, ""); // create empty file

  const CODE_BLOCK_REGEX = /^```[a-zA-Z]+\n/; // Matches code blocks like ```language
  const END_BLOCK_REGEX = /\n```$/; // Matches closing code blocks
  const BUFFER_SIZE = 100; // Adjust as needed
  const END_BUFFER_SIZE = 10; // Size to capture the closing block
  let buffer = "";
  let endBuffer = "";
  let isBufferProcessed = false;

  const fileStream = createWriteStream(distPath);
  for await (const chunk of completionStream) {
    // ollama returns a string, but OpenAI returns an object
    let content = JENNGEN_OLLAMA_MODEL
      ? chunk
      : chunk.choices[0]?.delta?.content;

    if (typeof content !== "string") continue;

    // We need to buffer the output to remove the Markdown code blocks
    if (!isBufferProcessed) {
      buffer += content;
      if (buffer.length >= BUFFER_SIZE) {
        // Process buffer and write to file
        const match = buffer.match(CODE_BLOCK_REGEX);
        if (match) {
          buffer = buffer.substring(match[0].length);
        }
        fileStream.write(buffer);
        buffer = ""; // Clear buffer
        isBufferProcessed = true;
      }
    } else {
      endBuffer += content;
      if (endBuffer.length > END_BUFFER_SIZE) {
        // Write to file except for the last part reserved in endBuffer
        fileStream.write(
          endBuffer.substring(0, endBuffer.length - END_BUFFER_SIZE)
        );
        endBuffer = endBuffer.substring(endBuffer.length - END_BUFFER_SIZE);
      }
    }
  }

  // Process the end buffer to remove the closing Markdown block
  if (END_BLOCK_REGEX.test(endBuffer)) {
    endBuffer = endBuffer.replace(END_BLOCK_REGEX, "");
  }
  fileStream.write(endBuffer);
  fileStream.end();
  liveReloadServer?.refresh();

  console.log(chalk.green(`Generated ${file.name}`));
  await updateCache(sourceFolder, file);
}

async function startServer(sourceFolder, watchFlag = false) {
  const app = express();
  app.use(connectLivereload({ port: LIVERELOAD_PORT }));
  app.use(express.static(path.join(sourceFolder, DIST_DIR)));

  app.listen(SERVER_PORT, () => {
    console.log(chalk.green(`Serving at http://localhost:${SERVER_PORT}`));
  });

  if (!watchFlag) return [app, null];

  const liveReloadServer = livereload.createServer({ port: LIVERELOAD_PORT });
  liveReloadServer.watch(path.join(sourceFolder, DIST_DIR));

  watch(
    path.join(sourceFolder, DIST_DIR),
    { recursive: true, persistent: true },
    (_, filename) => {
      if (filename.includes(CACHE_DIR)) return;
      if (filename.includes(DIST_DIR)) return;

      liveReloadServer.refresh(filename);
      console.log(chalk.magenta(`Reloaded due to change in ${filename}`));
    }
  );

  return [app, liveReloadServer];
}

async function main() {
  const argv = yargs(hideBin(process.argv))
    .scriptName("jenngen")
    .usage("$0 <source folder> [args]")
    .option("watch", {
      alias: "w",
      type: "boolean",
      description: "Watch for file changes",
    })
    .option("force", {
      alias: "f",
      type: "boolean",
      description: "Always generate files",
    })
    .option("server", {
      alias: "s",
      type: "boolean",
      description: "Serve files with live reload",
    })
    .option("help", {
      alias: "h",
      type: "boolean",
      description: "Show help",
    }).argv;

  if (argv.help) {
    yargs.showHelp();
    return;
  }

  const sourceFolder = path.join(process.cwd(), argv._[0] || "");
  const distFolder = path.join(sourceFolder, DIST_DIR);
  await fs.mkdir(distFolder, { recursive: true });
  const cacheFolder = path.join(sourceFolder, CACHE_DIR);
  await fs.mkdir(cacheFolder, { recursive: true });

  console.log(chalk.magenta(`Source folder: ${sourceFolder}`));

  // use instructions file if it exists
  let assistantPrompt = "";
  if (
    (await fs
      .stat(path.join(sourceFolder, INSTRUCTION_FILE))
      .catch(() => false)) === false
  ) {
    assistantPrompt = ASSISTANT_PROMPT.replace("<<<INSTRUCTIONS>>>", "");
  } else {
    const instructions = await fs.readFile(
      path.join(sourceFolder, INSTRUCTION_FILE),
      "utf-8"
    );
    assistantPrompt = ASSISTANT_PROMPT.replace(
      "<<<INSTRUCTIONS>>>",
      instructions
    );
  }

  let liveReloadServer;
  if (argv.server) {
    [, liveReloadServer] = await startServer(sourceFolder, argv.watch);
  }

  await build(sourceFolder, assistantPrompt, argv.force);

  if (argv.watch) {
    await watchForChanges(sourceFolder, assistantPrompt, liveReloadServer);
  }
}

async function build(sourceFolder, assistantPrompt, force = false) {
  const files = await getFiles(sourceFolder);
  assistantPrompt = assistantPrompt.replace(
    "<<<FILES>>>",
    files
      .filter((f) => f)
      .map((f) => f.name)
      .join("\n")
  );

  try {
    await Promise.all(
      files.map((file) =>
        generateCode(sourceFolder, assistantPrompt, file, null, force)
      )
    );
  } catch (err) {
    console.error(chalk.red(`Generation failed`), err);
  }

  console.log(chalk.green("Files generated"));
}

async function watchForChanges(
  sourceFolder,
  assistantPrompt,
  liveReloadServer = null
) {
  console.log(chalk.green("Watching for changes..."));
  watch(sourceFolder, { recursive: true }, async (_, filename) => {
    if (!filename) return;
    if (filename.includes(DIST_DIR)) return;
    if (filename.includes(CACHE_DIR)) return;

    const filePath = path.join(sourceFolder, filename);

    try {
      const stats = await fs.stat(filePath);
      if (!stats.isFile()) return;

      const content = await fs.readFile(filePath, "utf-8");
      const file = { name: filename, path: filePath, content };

      await generateCode(sourceFolder, assistantPrompt, file, liveReloadServer);
    } catch (err) {
      console.error(chalk.red(`Generation failed ${filename}: ${err}`));
    }
  });
}

try {
  main();
} catch (err) {
  console.error(chalk.red("JennGen failed"), err);
}
