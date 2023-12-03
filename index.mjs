import { createWriteStream } from "fs";
import fs from "fs/promises";
import OpenAI from "openai";
import path from "path";

const openai = new OpenAI();

const ASSISTANT_PROMPT = `
You are Jenngen, an AI static site generator. Your task is to transform given pseudo-code into high-quality, deployable code, matching the content and file name specifications.

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

// Get a tree of files and folders, their names and contents
async function getFiles(folder) {
  const files = await fs.readdir(folder, { withFileTypes: true });
  return Promise.all(
    files.map(async (file) => {
      if (file.name === "dist") return null;
      if (file.name === ".jenngen") return null;

      const path = `${folder}/${file.name}`;
      const content = file.isFile() ? await fs.readFile(path, "utf-8") : null;
      return { name: file.name, path, content };
    })
  );
}

async function completion(assistant, prompt) {
  return await openai.chat.completions.create({
    messages: [
      { role: "assistant", content: assistant },
      { role: "user", content: prompt },
    ],
    model: "gpt-3.5-turbo",
    stream: true,
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
  console.log(`Generating ${file.path}`);

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
  const fileStream = createWriteStream(distPath);
  for await (const chunk of completionStream) {
    if (typeof chunk.choices[0]?.delta?.content !== "string") continue;
    fileStream.write(chunk.choices[0].delta.content);
  }
  fileStream.end();

  console.log(`Generated ${distPath}`);
}

async function main(sourceFolder) {
  console.log(`Source folder: ${sourceFolder}`);

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

  const files = await getFiles(sourceFolder);
  assistantPrompt = assistantPrompt.replace(
    "<<<FILES>>>",
    files
      .filter((f) => f)
      .map((f) => f.name)
      .join("\n")
  );

  await Promise.all(files.map((file) => generateCode(assistantPrompt, file)));

  console.log("Done");
}

try {
  const source = path.join(process.cwd(), process.argv.pop() || "");
  main(source);
} catch (err) {
  console.error(err);
}
