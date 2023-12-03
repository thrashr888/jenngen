import chalk from "chalk";
import crypto from "crypto";
import { createWriteStream, watch } from "fs";
import fs from "fs/promises";
import OpenAI from "openai";
import path from "path";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

const CACHE_DIR = ".jenngen/cache";

const openai = new OpenAI();

const ASSISTANT_PROMPT = `
You are JennGen, an AI static site generator. Your task is to transform given pseudo-code or instructions into high-quality, deployable code, matching the content and file name specifications.

Input File Contents:
- The input may include mixed content types, like markdown with JavaScript, or prose with CSS.
- Text within quotes should be used verbatim. E.g., "Insert privacy policy here" means inserting a standard privacy policy.
- Outside of quotes, generate professional-grade code or copy suitable for the type of file.
- Eliminate all pseudo-code or placeholder content. The output must be real, deployable code or functional prose.
- Avoid filler content like "lorem ipsum" or emojis, unless specifically requested.

Output File Specifications:
- The output code language should correspond to the file extension (e.g., .html for HTML, .js for JavaScript, .tf for Terraform, .css for CSS, Makefile for a valid Make file).
- Ensure text has correct capitalization, spelling, and grammar.
- For HTML, use style tags, inline CSS, and Tailwind (CDN url: https://cdn.tailwindcss.com).
- Implement dynamic content as needed using JavaScript script tags.
- All output code should be functional and ready for website deployment.
- Provide only the code output, without markdown or explanatory prose.

User Instructions for the Website:
<<<INSTRUCTIONS>>>

Current Folder Files:
<<<FILES>>>

Pseudo-Code Input Examples:
===========================
<<<INPUT>>>

Real Code Output Examples:
===========================
<<<OUTPUT>>>
`;

const USER_PROMPT = `Based on the provided pseudo-code, generate the corresponding code. Ensure the output is purely code, devoid of markdown or explanatory prose.
`;

const FILE_PROMPT = `File: <<<FILENAME>>>
Contents:
<<<CONTENTS>>>`;

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
      if (entry.name === "dist") return null;
      if (entry.name === ".jenngen") return null;
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
    model: "gpt-3.5-turbo",
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

async function generateCode(assistantPrompt, file) {
  if (!file) return;
  if (!(await hasFileChanged(file))) {
    console.log(chalk.blue(`Skipping ${file.path}`));
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

  const distPath = file.path.replace("website", "dist");

  // create folder if it doesn't exist
  await fs.mkdir(path.dirname(distPath), { recursive: true });

  await fs.writeFile(distPath, ""); // create empty file
  const fileStream = createWriteStream(distPath);
  for await (const chunk of completionStream) {
    if (typeof chunk.choices[0]?.delta?.content !== "string") continue;
    fileStream.write(chunk.choices[0].delta.content);
  }
  fileStream.end();

  console.log(chalk.green(`Generated ${distPath}`));
  await updateCache(file);
}

async function main() {
  const argv = yargs(hideBin(process.argv)).option("watch", {
    alias: "w",
    type: "boolean",
    description: "Watch for file changes",
  }).argv;

  const sourceFolder = path.join(process.cwd(), argv._[0] || "");

  console.log(chalk.magenta(`Source folder: ${sourceFolder}`));

  let assistantPrompt = "";
  if (
    (await fs.stat(path.join(sourceFolder, ".jenngen")).catch(() => false)) ===
    false
  ) {
    assistantPrompt = ASSISTANT_PROMPT.replace("<<<INSTRUCTIONS>>>", "");
  } else {
    const instructions = await fs.readFile(
      path.join(sourceFolder, ".jenngen"),
      "utf-8"
    );
    assistantPrompt = ASSISTANT_PROMPT.replace(
      "<<<INSTRUCTIONS>>>",
      instructions
    );
  }

  await fs.mkdir(CACHE_DIR, { recursive: true });

  if (argv.watch) {
    console.log(chalk.green("Watching for changes..."));
    await watchForChanges(sourceFolder, assistantPrompt);
  } else {
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

      console.log(chalk.green("Done"));
    } catch (err) {
      console.error(chalk.red("Error"), err);
    }
  }
}

async function watchForChanges(sourceFolder, assistantPrompt) {
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
        await generateCode(assistantPrompt, file);
      } else {
        console.log(chalk.blue(`No changes in ${filename}`));
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
