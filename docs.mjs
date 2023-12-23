import chalk from "chalk";
import { exec } from "child_process";
import fs from "fs/promises";
import { DirectoryLoader } from "langchain/document_loaders/fs/directory";
import { TextLoader } from "langchain/document_loaders/fs/text";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import path from "path";
import util from "util";

const {
  JENNGEN_CHUNK_SIZE: CHUNK_SIZE = 500,
  JENNGEN_CHUNK_OVERLAP: CHUNK_OVERLAP = 10,
} = process.env;

const execAsync = util.promisify(exec);

const SEARCH_PROMPT = `Extract key technical terms from the given pseudo-code to create a list of search queries. Focus on identifying unique, specific terms relevant for searching technical documentation in markdown format. Exclude common words and phrases that are unlikely to yield meaningful search results. The output should be a concise, comma-separated list of terms that highlight areas or concepts in the pseudo-code that require further understanding or clarification. Do not include any explanatory text or descriptions. 

Input Pseudo-Code:
<<<INPUT>>>

Search Terms:
`;

const fileExists = async (path) => {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
};

// splits search terms by comma, new line, or markdown list
function searchTermsSplitter(searchTerms) {
  return searchTerms
    .split("\n")
    .filter(
      (t) => t !== "" && !t.includes("pseudo-code") && !t.includes("terms")
    )
    .join("\n")
    .replaceAll('"', "")
    .split(/,|\n|\*/)
    .map((term) => term.trim())
    .filter((t) => t !== "");
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // Escapes special characters for RegExp
}

function findMostRelevantSnippets(
  content,
  termRegex,
  maxSnippets,
  snippetLength
) {
  const paragraphs = content.split("\n\n"); // Splitting the content into paragraphs
  let matchedParagraphs = [];

  for (const paragraph of paragraphs) {
    if (termRegex.test(paragraph)) {
      matchedParagraphs.push(paragraph);
    }
  }

  // Sort paragraphs by the number of term occurrences, descending
  matchedParagraphs.sort(
    (a, b) =>
      (b.match(termRegex) || []).length - (a.match(termRegex) || []).length
  );

  // Limiting the number of snippets
  return matchedParagraphs
    .slice(0, maxSnippets)
    .map((snippet) =>
      snippet.length > snippetLength
        ? snippet.substring(0, snippetLength) + "..."
        : snippet
    );
}

export async function searchDocs(docs = [], query, completion) {
  if (!query || docs.length === 0) return new Map();

  const completionStream = await completion(
    "",
    SEARCH_PROMPT.replace("<<<INPUT>>>", query)
  );
  let search = "";
  for await (const chunk of completionStream) {
    search += chunk;
  }

  const searchTerms = searchTermsSplitter(search);
  console.log("Searching for:", searchTerms);

  const SNIPPET_LENGTH = 400; // Adjust as needed
  const MAX_SNIPPETS_PER_TERM = 2; // Limit the number of snippets per term
  let relevantContent = new Map();

  for (const doc of docs) {
    for (const rawTerm of searchTerms) {
      const term = escapeRegExp(rawTerm);
      const termRegex = new RegExp(`\\b${term}\\b`, "gi");

      const excerpts = findMostRelevantSnippets(
        doc.pageContent,
        termRegex,
        MAX_SNIPPETS_PER_TERM,
        SNIPPET_LENGTH
      );

      if (excerpts.length > 0) {
        if (!relevantContent.has(rawTerm)) {
          relevantContent.set(rawTerm, []);
        }
        relevantContent
          .get(rawTerm)
          .push({ file: doc.metadata.source, excerpts });
      }
    }
  }

  return relevantContent;
}

export function searchToPrompts(searchResults) {
  let searchPrompts = [];
  searchResults.forEach((results, term) => {
    let prompt = `term: ${term}\nresults:\n`;
    results.forEach((result) => {
      prompt += `  - file: ${result.file}\n    excerpts:\n`;
      if (Array.isArray(result.excerpts)) {
        result.excerpts.forEach((excerpt) => {
          prompt += `      - ${excerpt}\n`;
        });
      } else if (result.excerpts) {
        prompt += `      - ${result.excerpts}\n`;
      }
    });
    searchPrompts.push(prompt);
  });
  return searchPrompts;
}

const cloneOrPullRepo = async (saveFolder, repoUrl) => {
  const localRepoPath = path.join(
    saveFolder,
    repoUrl.split("/").pop().split(".git")[0]
  );

  try {
    if (await fileExists(localRepoPath)) {
      console.log(chalk.yellow(`Pulling ${repoUrl}`));
      await execAsync("git pull", { cwd: localRepoPath });
    } else {
      console.log(chalk.yellow(`Cloning ${repoUrl}`));
      await fs.mkdir(localRepoPath, { recursive: true });
      await execAsync(`git clone --depth 1 ${repoUrl} ${localRepoPath}`);
    }
  } catch (err) {
    console.error(chalk.red(`Git operation failed for ${repoUrl}: ${err}`));
    return null;
  }
};

export async function loadDocs(docsFolder) {
  const reposAndFolders = JSON.parse(await fs.readFile("./docs.json", "utf-8"));

  // clone or pull repos in parallel
  const promises = reposAndFolders.map((repoInfo) =>
    cloneOrPullRepo(docsFolder, repoInfo[0])
  );
  await Promise.all(promises);
  console.log(chalk.green("Done cloning."));

  console.log(chalk.yellow("Loading documents..."));
  const loader = new DirectoryLoader(
    docsFolder,
    {
      ".mdx": (path) => new TextLoader(path),
      ".md": (path) => new TextLoader(path),
    },
    true,
    "ignore"
  );

  const docs = await loader.load();

  const splitter = new RecursiveCharacterTextSplitter({
    chunkOverlap: CHUNK_OVERLAP,
    chunkSize: CHUNK_SIZE,
  });

  const splitDocuments = await splitter.splitDocuments(docs);
  console.log(chalk.green("Done loading documents."));
  return splitDocuments;
}
