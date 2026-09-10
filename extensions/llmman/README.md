# llmman Extension

Integrates [llmman](https://github.com/llmmanorg/llmman) local AI models with Kaiden. Automatically discovers and registers models available from the llmman daemon running on `localhost:17434`.

## Requirements

- [llmman](https://github.com/llmmanorg/llmman) installed and running locally (`llmman serve`)

## Usage

1. Pull a model: `llmman pull <model-name>`
2. Models will automatically appear in Kaiden's llmman provider
3. Select any model to start chatting

## Configuration

Set `llmman.endpoint` in Kaiden preferences if the daemon listens on a non-default `LLMMAN_HOST` (default `http://localhost:17434`).
