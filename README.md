# JennGen

AI static site generator. Given a folder of pseudocode, JennGen generates a folder of real code. Works best with HTML, CSS, and JavaScript, but it can translate any language or text-based file format. For example, you can use a Markdown bullet list of instructions to generate a Dockerfile. Given good examples, you should be able to generate Terraform, Python, or JSON as-needed for functionality beyond a basic static site.

## Running it

Get your OpenAI key from [https://beta.openai.com/](https://beta.openai.com/).

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

## How it works

JennGen uses OpenAI's GPT4 to translate pseudocode into real code, using custom prompting and examples. You can add a `.jenngen` file to your project to provide further instructions.

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
npx jenngen <input folder> [options]
```

- `--watch` - watch for changes and rebuild
- `--server` - start a server to serve the output folder

## Environment variables

- JENNGEN_CACHE - cache folder (default: `.jenngen_cache`)
- JENNGEN_DIST - output folder (default: `.dist`)
- JENNGEN_INSTRUCTIONS - instructions file (default: `.jenngen`)
- JENNGEN_LIVERELOAD_PORT - livereload port (default: `35729`)
- JENNGEN_MODEL - OpenAI model (default: `gpt-4-1106-preview`)
- JENNGEN_PORT - server port (default: `3000`)

## Examples

See the [`website`](./website) folder for more examples.

Your file:

```
hello world
```

Dist file:

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

## TODO

- [ ] Add quality examples for more languages and file formats.
- [ ] I'm pretty sure there's bugs with npx and the JennGen example folders because the cwd confuses me.
- [ ] Add a way to serve the output folder without watching. I think we're double watching and reloading.
- [ ] Use JennGen to generate a website for its GitHub Pages.
- [ ] Record a demo video for the readme, website, and Twitter.
- [ ] Support website layouts. Maybe a `_layout.html` file?
