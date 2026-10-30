# LLM Pricing Scraper - OpenRouter AI Model & Token Costs

Know what every LLM API call costs — and which provider serves a model cheapest, fastest and most reliably.

This Actor collects the full OpenRouter catalogue (450+ AI models, including GPT, Claude, Gemini and Llama) with prices converted to **USD per million tokens**, and then, for each model, every provider serving it with that provider's own price, uptime, latency and throughput.

No API key needed.

## Why the provider breakdown matters

The same model is served by many providers at different prices and speeds. Claude Haiku 5.5, for example, is available from Anthropic, Google, Azure, Amazon Bedrock and others — same model, different price, different latency, different uptime. Most price lists stop at the model level and miss this entirely.

## What you get

Three kinds of row, each tagged with `type`:

**`model`** — one per model in the catalogue

| Field | Meaning |
| --- | --- |
| `modelId`, `name`, `author` | `anthropic/claude-haiku-5.5` |
| `inputPricePerMillionUsd` | Input price per 1M tokens |
| `outputPricePerMillionUsd` | Output price per 1M tokens |
| `cacheReadPricePerMillionUsd`, `cacheWritePricePerMillionUsd` | Prompt-caching prices |
| `contextLength`, `maxCompletionTokens` | Size limits |
| `inputModalities`, `outputModalities` | text, image, file, audio |
| `isFree` | Whether both token prices are zero |

**`provider_endpoint`** — one per provider serving that model

| Field | Meaning |
| --- | --- |
| `providerName` | Who actually serves it |
| `inputPricePerMillionUsd`, `outputPricePerMillionUsd` | That provider's price |
| `uptimeLast30m`, `uptimeLast1d` | Reliability |
| `latencyMsLast30m` | Time to first token |
| `throughputLast30m` | Tokens per second |
| `quantization` | fp8, bf16, unknown … |
| `supportsTools`, `toolChoiceModes` | Tool-calling support |

**`ollama_model`** — optional, models from the Ollama library that run on your own hardware (token price zero).

## Input

| Field | Type | Description |
| --- | --- | --- |
| `models` | array | Model ids or fragments, e.g. `anthropic/claude`. Empty collects the whole catalogue |
| `includeProviderBreakdown` | boolean | Fetch per-provider rows (default on) |
| `maxBreakdownModels` | integer | How many models to break down, cheapest first (default 25) |
| `includeOllama` | boolean | Also list the Ollama library |
| `maxPricePerMillionInputUsd` | integer | Drop models above this input price |
| `maxItems` | integer | Row cap |

### Example input

```json
{
    "models": ["anthropic/claude", "openai/gpt-5"],
    "includeProviderBreakdown": true,
    "maxBreakdownModels": 10,
    "maxItems": 300
}
```

## Uses

- **Budgeting** — compare real per-million prices instead of per-token decimals
- **Provider selection** — find the cheapest provider that still meets your latency and uptime bar
- **Cost alerts** — schedule it daily and watch for price changes
- **Model shopping** — filter by price, context length or modality

## Notes and limits

- Prices come from OpenRouter's public catalogue. A provider's direct price can differ from what OpenRouter lists.
- Models tagged `:batch` are batch endpoints: cheaper, with no uptime or latency figures.
- The provider breakdown costs one request per model, so collecting it for the whole catalogue is slow. `maxBreakdownModels` keeps runs short.
- Prices are a snapshot of the moment the run happened.

## FAQ

**Do I need an OpenRouter account?**
No. The catalogue and endpoint data are public.

**Why are prices per million tokens when the API gives per token?**
Because that is how vendors quote and how teams budget. The raw values are fractions like `0.0000001`, which are awkward to compare.

**Does this include models not on OpenRouter?**
Not yet. Turn on `includeOllama` for locally-runnable open models.
