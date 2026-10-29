// LLM pricing scraper — OpenRouter model catalogue + per-provider endpoints,
// optionally the Ollama library for locally-runnable models.
//
// OpenRouter quotes prices per single token as strings ("0.0000001"). Everything
// here is converted to USD per million tokens, which is how vendors actually
// quote and how teams budget.
import { Actor, log } from 'apify';

await Actor.init();

const {
    models = [],
    includeProviderBreakdown = true,
    maxBreakdownModels = 25,
    includeOllama = false,
    maxPricePerMillionInputUsd = null,
    maxItems = 1000,
} = (await Actor.getInput()) ?? {};

const OPENROUTER_MODELS = 'https://openrouter.ai/api/v1/models';
const OLLAMA_LIBRARY = 'https://ollama.com/library';
const PER_MILLION = 1_000_000;

let pushed = 0;
let stopped = false;

Actor.on('aborting', async () => {
    stopped = true;
    log.info(`Abort requested — ${pushed} rows saved.`);
    await Actor.exit();
});

const budgetLeft = () => !stopped && pushed < maxItems;

const save = async (row) => {
    if (!budgetLeft()) return;
    await Actor.pushData(row);
    pushed += 1;
};

/** OpenRouter returns per-token prices as strings; "" and "0" both mean free. */
const perMillion = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return Number((n * PER_MILLION).toFixed(6));
};

const round = (n, places = 2) =>
    typeof n === 'number' && Number.isFinite(n) ? Number(n.toFixed(places)) : null;

async function fetchJson(url, attempts = 3) {
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            const res = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; apify-llm-pricing-scraper)',
                    Accept: 'application/json',
                },
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        } catch (error) {
            if (attempt === attempts) {
                log.warning(`Giving up on ${url}: ${error.message}`);
                return null;
            }
            await new Promise((resolve) => setTimeout(resolve, 800 * attempt));
        }
    }
    return null;
}

const modelRow = (m) => {
    const p = m.pricing ?? {};
    return {
        type: 'model',
        modelId: m.id ?? null,
        name: m.name ?? null,
        author: typeof m.id === 'string' && m.id.includes('/') ? m.id.split('/')[0] : null,
        contextLength: m.context_length ?? null,
        inputPricePerMillionUsd: perMillion(p.prompt),
        outputPricePerMillionUsd: perMillion(p.completion),
        cacheReadPricePerMillionUsd: perMillion(p.input_cache_read),
        cacheWritePricePerMillionUsd: perMillion(p.input_cache_write),
        webSearchPriceUsd: p.web_search ? Number(p.web_search) : null,
        isFree: perMillion(p.prompt) === 0 && perMillion(p.completion) === 0,
        inputModalities: m.architecture?.input_modalities ?? [],
        outputModalities: m.architecture?.output_modalities ?? [],
        tokenizer: m.architecture?.tokenizer ?? null,
        maxCompletionTokens: m.top_provider?.max_completion_tokens ?? null,
        isModerated: m.top_provider?.is_moderated ?? null,
        createdAt: m.created ? new Date(m.created * 1000).toISOString() : null,
        url: m.id ? `https://openrouter.ai/${m.id}` : null,
        scrapedAt: new Date().toISOString(),
    };
};

const endpointRow = (modelId, e) => {
    const p = e.pricing ?? {};
    return {
        type: 'provider_endpoint',
        modelId,
        providerName: e.provider_name ?? null,
        name: e.name ?? null,
        contextLength: e.context_length ?? null,
        inputPricePerMillionUsd: perMillion(p.prompt),
        outputPricePerMillionUsd: perMillion(p.completion),
        cacheReadPricePerMillionUsd: perMillion(p.input_cache_read),
        quantization: e.quantization ?? null,
        status: e.status === null || e.status === undefined ? null : String(e.status),
        uptimeLast30m: round(e.uptime_last_30m, 4),
        uptimeLast1d: round(e.uptime_last_1d, 4),
        latencyMsLast30m: round(e.latency_last_30m, 1),
        throughputLast30m: round(e.throughput_last_30m, 2),
        maxCompletionTokens: e.max_completion_tokens ?? null,
        // supports_tool_choice arrives either as a boolean or as a map of the
        // modes a provider accepts ({none, auto, required, function}).
        supportsTools:
            e.supports_tool_choice && typeof e.supports_tool_choice === 'object'
                ? Object.values(e.supports_tool_choice).some(Boolean)
                : (e.supports_tool_choice ?? null),
        toolChoiceModes:
            e.supports_tool_choice && typeof e.supports_tool_choice === 'object'
                ? Object.entries(e.supports_tool_choice)
                      .filter(([, allowed]) => allowed)
                      .map(([mode]) => mode)
                : [],
        url: `https://openrouter.ai/${modelId}`,
        scrapedAt: new Date().toISOString(),
    };
};

// ---------------------------------------------------------------- OpenRouter
const catalogue = await fetchJson(OPENROUTER_MODELS);
let allModels = catalogue?.data ?? [];
log.info(`OpenRouter catalogue: ${allModels.length} models`);

const wanted = models.map((m) => String(m).trim().toLowerCase()).filter(Boolean);
if (wanted.length > 0) {
    allModels = allModels.filter((m) => {
        const id = String(m.id ?? '').toLowerCase();
        return wanted.some((w) => id === w || id.includes(w));
    });
    log.info(`Filtered to ${allModels.length} models matching the input.`);
}

const rows = allModels.map(modelRow).filter((r) => {
    if (maxPricePerMillionInputUsd === null) return true;
    return (r.inputPricePerMillionUsd ?? Infinity) <= maxPricePerMillionInputUsd;
});

rows.sort((a, b) => (a.inputPricePerMillionUsd ?? Infinity) - (b.inputPricePerMillionUsd ?? Infinity));

for (const row of rows) {
    if (!budgetLeft()) break;
    await save(row);
}
log.info(`Saved ${pushed} model rows.`);

// ---------------------------------------------------------------- per-provider prices
if (includeProviderBreakdown && budgetLeft()) {
    const targets = rows.slice(0, Math.max(0, maxBreakdownModels));
    log.info(`Fetching provider breakdown for ${targets.length} models…`);

    for (const row of targets) {
        if (!budgetLeft()) break;
        const data = await fetchJson(`${OPENROUTER_MODELS}/${row.modelId}/endpoints`);
        const endpoints = data?.data?.endpoints ?? [];
        if (endpoints.length === 0) continue;

        const sorted = [...endpoints].sort(
            (a, b) => Number(a.pricing?.prompt ?? Infinity) - Number(b.pricing?.prompt ?? Infinity),
        );
        for (const e of sorted) {
            if (!budgetLeft()) break;
            await save(endpointRow(row.modelId, e));
        }
        log.info(`${row.modelId}: ${endpoints.length} providers`);
    }
}

// ---------------------------------------------------------------- Ollama
if (includeOllama && budgetLeft()) {
    try {
        const res = await fetch(OLLAMA_LIBRARY, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; apify-llm-pricing-scraper)' },
        });
        const html = await res.text();
        const names = [...new Set([...html.matchAll(/href="\/library\/([a-z0-9._-]+)"/g)].map((m) => m[1]))];
        log.info(`Ollama library: ${names.length} models`);
        for (const name of names) {
            if (!budgetLeft()) break;
            await save({
                type: 'ollama_model',
                modelId: name,
                name,
                author: 'ollama',
                url: `https://ollama.com/library/${name}`,
                // Runs on your own hardware, so there is no per-token price.
                inputPricePerMillionUsd: 0,
                outputPricePerMillionUsd: 0,
                isFree: true,
                scrapedAt: new Date().toISOString(),
            });
        }
    } catch (error) {
        log.warning(`Ollama library failed: ${error.message}`);
    }
}

log.info(`Done. ${pushed} rows saved.`);
await Actor.exit();
