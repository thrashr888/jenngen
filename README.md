# JennGen

AI static site generator. Given a folder of pseudocode, JennGen generates a folder of real code. It works best with HTML, CSS, and JavaScript, but it can translate any language or text-based file format. For example, you can use a Markdown bullet list of instructions to generate a Dockerfile. Given good examples, you should be able to generate Terraform, Python, or JSON as needed for functionality beyond a basic static site.

## Running it

Get your OpenAI key from [https://platform.openai.com/api-keys](https://platform.openai.com/api-keys).

Build it once:

```
export OPENAI_API_KEY=<YOUR_API_KEY>
npx jenngen .
```

Build it continuously:

```
npx jenngen . --watch --server
open localhost:3000
```

## Local models with Ollama

You can use a local model with Ollama. This is useful if you want to use an open source model that is not available on OpenAI's API. You can also use it to avoid the API rate limits. See the [Ollama model library](https://ollama.ai/library) for the list of available models.

```
brew install ollama
brew services start ollama
ollama pull mistral
export JENNGEN_OLLAMA_MODEL=mistral
npx jenngen . --server
http://localhost:3000
```

## How it works

JennGen uses OpenAI's GPT4 to translate pseudocode into real code using custom prompting and examples. You can add a `.jenngen` file to your project to provide further instructions.

```
<your project>
├── .jenngen_cache
│   └── <cached files>
├── .dist
│   ├── index.html
│   ├── style.css
│   └── script.js
├── .jenngen
├── index.html
├── style.css
└── script.js
```

## .jenngen file

The `.jenngen` file is a plaintext file that contains instructions for JennGen. It can be used to provide examples, add custom prompts, and more.

## CLI Options

```bash
npx jenngen <source folder> [options]
```

- `--watch` - watch for changes and rebuild
- `--server` - start a server to serve the output folder

## Environment variables

- OPENAI_API_KEY - OpenAI API key (default: `null`)
- JENNGEN_CACHE - cache folder (default: `.jenngen_cache`)
- JENNGEN_DIST - output folder (default: `.dist`)
- JENNGEN_INSTRUCTIONS - instructions file (default: `.jenngen`)
- JENNGEN_LIVERELOAD_PORT - livereload port (default: `35729`)
- JENNGEN_MODEL - OpenAI model (default: `gpt-4-1106-preview`)
- JENNGEN_PORT - server port (default: `3000`)
- JENNGEN_OLLAMA_MODEL - Use a local Ollama model; overrides OPENAI_API_KEY (default: `null`)

## Examples

Your `index.html` file:

```
hello world
```

The generated `index.html` file:

```html
<!doctype html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Hello World</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body>
  <h1 class="text-3xl font-bold underline">
    Hello world!
  </h1>
</body>
</html>
```

<img width="940" alt="CleanShot 2023-12-04 at 09 21 35@2x" src="https://github.com/thrashr888/jenngen/assets/10213/fa726b3b-6045-4a07-8d1a-70f43074b721">

```
"Welcome to the JennGen website!"
{title}

[beautiful hero section explaining the product]

[insert high quality marketing content here]

## Getting Started

Using JennGen is easy. Just follow these steps:

1. Get your OpenAI key from [https://beta.openai.com/](https://beta.openai.com/)
2. Use npx to get jenngen and render the current folder: `npx jenngen .`
3. Open [http://localhost:3000](http://localhost:3000) to view it in the browser.

... insert more of a product story here ...

[insert a centered cat picture here from placekitten.com]

<time current>
<sparkles animated="true" count="3">

[footer with links to about, privacy, and terms]
```

See the [`website`](./website) folder for more examples.

## TODO

- [ ] Add quality examples for more languages and file formats.
- [ ] I'm pretty sure there are bugs with npx and the JennGen example folders because the cwd confuses me.
- [ ] Add a way to serve the output folder without watching. I think we're double-watching and reloading.
- [ ] Use JennGen to generate a website for its GitHub Pages.
- [ ] Record a demo video for the readme, website, and Twitter.
- [ ] Support website layouts. Maybe a `_layout.html` file?
