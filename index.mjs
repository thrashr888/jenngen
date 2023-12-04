import chalk from "chalk";
import connectLivereload from "connect-livereload";
import crypto from "crypto";
import express from "express";
import { createWriteStream, watch } from "fs";
import fs from "fs/promises";
import livereload from "livereload";
import OpenAI from "openai";
import path from "path";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

const LIVERELOAD_PORT = 35729;
const SERVER_PORT = 3000;
const DIST_DIR = "dist";
const INSTRUCTION_FILE = ".jenngen";
const CACHE_DIR = ".jenngen/cache";

const openai = new OpenAI();

const ASSISTANT_PROMPT = `
You are JennGen, an AI-driven static site generator. Your role is to convert provided pseudo-code or instructions into high-quality, deployable code, tailored to the file name and content specifications. The output should be similar to a $35,000 website from a top-tier web development agency using the latest development practices.

Input File Content Rules:
- Mixed Content Types: Inputs may include combinations such as markdown with JavaScript, or prose with CSS, or instruction text mixed with literal quotes.
- Literal Text: Text within double quotes ("") should be used exactly as is. For instance, "This is my description" translates directly into "This is my description".
- Dynamic Placeholders: Text within curly braces ({}) represents dynamic variables. Replace {title} with the actual title of the page.
- Instructional Text: Text within square brackets ([]) contains instructions to generate specific content. For example, [Insert a random number] should be replaced with an actual random number, and [Insert marketing copy here] should be replaced with professional marketing content.
- Interactive Elements: Text within angle brackets (<>) should be replaced with interactive or real-time content. E.g., <Ask the user for their name> becomes a user input prompt for their name, and <clock with current time> becomes a live JavaScript clock showing the current time.
- Professional Standard: All generated content should be professional-grade, appropriate for the file type, and devoid of any pseudo-code or placeholders.
- No Filler Content: Avoid using "lorem ipsum", emojis, or similar filler material, unless explicitly requested.

Output File Specifications:
- Language Match: Output code should correspond to the file extension (e.g., .html for HTML, .js for JavaScript).
- Text Quality: Ensure correct capitalization, spelling, and grammar.
- HTML Styling: Use style tags, inline CSS, and Tailwind (CDN: https://cdn.tailwindcss.com).
- HTML Quality: The webpage should be responsive, with good accessibility and semantic HTML for SEO.
- Dynamic JavaScript: Implement interactive or dynamic content as needed using JavaScript.
- Deployment-Ready: All output code must be functional and ready for website deployment.
- Pure Code Output: Provide only the code output, without markdown code blocks or explanatory prose.
- Design Quality: The output should feature an attractive, high-quality design with consistent styling across pages.

User Instructions for the Website:
<<<INSTRUCTIONS>>>

Current Folder Files:
<<<FILES>>>

Pseudo-Code Input Examples:
<<<INPUT>>>

Real Code Output Examples:
<<<OUTPUT>>>
`;

const USER_PROMPT = `Based on the provided pseudo-code, generate the corresponding code. Ensure the output is purely the code results, devoid of wrapping markdown code blocks or explanatory prose.
`;

const FILE_PROMPT = `FILE: <<<FILENAME>>>
CONTENTS: <<<CONTENTS>>>`;

function hashContent(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

async function hasFileChanged(file) {
  const hash = hashContent(file.content);
  const cacheFilePath = path.join(CACHE_DIR, file.path.replace(/\//g, "_"));
  try {
    const storedHash = await fs.readFile(cacheFilePath, "utf-8");
    return hash !== storedHash;
  } catch (error) {
    return true; // File not in cache or other error
  }
}

async function updateCache(file) {
  const hash = hashContent(file.content);
  const cacheFilePath = path.join(CACHE_DIR, file.path.replace(/\//g, "_"));
  await fs.writeFile(cacheFilePath, hash, "utf-8");
}

// Get a tree of files and folders, their names and contents
async function getFiles(folder) {
  const entries = await fs.readdir(folder, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      if (entry.name === DIST_DIR) return null;
      if (entry.name === INSTRUCTION_FILE) return null;
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
  return await openai.chat.completions.create({
    messages: [
      { role: "assistant", content: assistant },
      { role: "user", content: prompt },
    ],
    // model: "gpt-3.5-turbo",
    model: "gpt-4-1106-preview",
    stream: true,
    temperature: 0.5,
    top_p: 1,
  });
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
    // console.log(`Applying example ${example.path}`);
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

async function generateCode(assistantPrompt, file, liveReloadServer = null) {
  if (!file) return;
  if (!(await hasFileChanged(file))) {
    // console.log(chalk.blue(`Skipping ${file.path}`));
    return;
  }

  console.log(chalk.yellow(`Generating ${file.path}`));

  const fileExtension = file.path.split(".").pop();
  const examples = await getExamples(
    path.join(process.cwd(), "examples"),
    fileExtension
  );

  const renderedAssistantPrompt = applyExamples(assistantPrompt, examples);

  const userPrompt = applyFile(FILE_PROMPT, file.name, file.content);

  const completionStream = await completion(
    renderedAssistantPrompt,
    USER_PROMPT + userPrompt
  );

  const distPath = file.path.replace("website", DIST_DIR);

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
    if (typeof chunk.choices[0]?.delta?.content !== "string") continue;

    if (!isBufferProcessed) {
      buffer += chunk.choices[0].delta.content;
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
      endBuffer += chunk.choices[0].delta.content;
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

  console.log(chalk.green(`Generated ${distPath}`));
  await updateCache(file);
}

async function startServer() {
  const app = express();
  app.use(connectLivereload({ port: LIVERELOAD_PORT }));
  app.use(express.static(DIST_DIR));

  app.listen(SERVER_PORT, () => {
    console.log(chalk.green(`Serving at http://localhost:${SERVER_PORT}`));
  });

  const liveReloadServer = livereload.createServer({ port: LIVERELOAD_PORT });
  liveReloadServer.watch(path.join(process.cwd(), DIST_DIR));

  watch(DIST_DIR, { recursive: true, persistent: true }, (_, filename) => {
    liveReloadServer.refresh(filename);
    console.log(chalk.magenta(`Reloaded due to change in ${filename}`));
  });

  return [app, liveReloadServer];
}

async function main() {
  const argv = yargs(hideBin(process.argv))
    .option("watch", {
      alias: "w",
      type: "boolean",
      description: "Watch for file changes",
    })
    .option("server", {
      alias: "s",
      type: "boolean",
      description: "Serve files with live reload",
    }).argv;

  const sourceFolder = path.join(process.cwd(), argv._[0] || "");

  console.log(chalk.magenta(`Source folder: ${sourceFolder}`));

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

  await fs.mkdir(CACHE_DIR, { recursive: true });

  let liveReloadServer;
  if (argv.server) {
    const [app, liveReloadServer] = await startServer();
  }

  await build(sourceFolder, assistantPrompt);

  if (argv.watch) {
    await watchForChanges(sourceFolder, assistantPrompt, liveReloadServer);
  }
}

async function build(sourceFolder, assistantPrompt) {
  try {
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
        files.map((file) => generateCode(assistantPrompt, file))
      );
    } catch (err) {
      console.error(chalk.red("Generation failed"), err);
    }

    console.log(chalk.green("Filed generated"));
  } catch (err) {
    console.error(chalk.red("Error"), err);
  }
}

async function watchForChanges(
  sourceFolder,
  assistantPrompt,
  liveReloadServer = null
) {
  console.log(chalk.green("Watching for changes..."));
  watch(sourceFolder, { recursive: true }, async (_, filename) => {
    if (!filename) {
      return;
    }

    const filePath = path.join(sourceFolder, filename);

    try {
      const stats = await fs.stat(filePath);
      if (!stats.isFile()) {
        return;
      }

      const content = await fs.readFile(filePath, "utf-8");
      const file = { name: filename, path: filePath, content };

      // Check if the file has changed
      if (await hasFileChanged(file)) {
        await generateCode(assistantPrompt, file, liveReloadServer);
        // if (liveReloadServer) liveReloadServer.refresh();
      }
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
