# widen — search wider, not deeper

A recall-maximizing layer on Firecrawl `/search` that probes a topic many
different ways, merges the results, and **reports how complete the search
actually was.** CLI-first (overnight batch jobs), with a dashboard that makes the
coverage legible. Built for the competitive-intelligence customer whose whole
complaint is completeness.

---

## The pick (and why this one)

> *"We run search at limit 50 and our analysts still hand-find sources it never
> surfaced. Going from 10 to 50 just gave 40 more of the same popular sites."*
> — feedback #1 (enterprise, **$180k ARR, flat, renewal Q3, expanding to 2 more teams**)

Raising `limit` reads **one ranking deeper**. The long tail — trade pubs,
regional press, niche forums — doesn't live deeper in that one ranking; it lives
in *different* rankings. Firecrawl `/search` already exposes the levers that
produce different rankings (`sources`, `categories`, `tbs`, `location`, and the
query string itself), but a customer calling `/search` once never composes them.
**That composition is the thin missing layer.** I built it.

Two design commitments fall straight out of the brief:

1. **Don't rebuild the deprecated deep-research endpoint.** It was an opaque
   agent loop; Firecrawl replaced it with `/search` + an agent, and deprecating
   it was a signal. `widen` is the opposite: a **deterministic, inspectable
   fan-out**. Every probe, why it exists, and exactly what it contributed is
   visible. Nothing about it is a black box.
2. **Coverage is only useful if it's trustworthy.** So the headline output isn't
   the result list — it's an **honest coverage report**: a saturation curve, a
   statistical estimate of how many sources we *missed*, and a blunt
   thin/moderate/saturated verdict. "Latency doesn't matter, completeness does"
   means the product is the *confidence*, not the speed.

### Why this isn't the `/search` playground (the edge)

Firecrawl's [search playground](https://www.firecrawl.dev/app/playground?endpoint=search)
exposes the same primitives widen uses — `sources`, `categories`, `tbs`,
`location`, `includeDomains`, `limit`. I expose those knobs too, on purpose, so
the natural question is: *isn't this a UI wrapper around the playground?* No — and
the difference is exactly the customer's complaint.

The playground runs **one** `/search` and shows **one** ranking. That is the
thing the customer says fails them: *"limit 50 gave 40 more of the same; the
sources we miss don't show up at any limit."* No combination of playground knobs
fixes that, because every single call still returns one popularity-ranked list.
Setting `tbs` or `location` in the playground just gives you *a different* single
list — you'd have to run, read, and reconcile dozens of them by hand. **That
manual reconciliation is the product.** widen's edge is the layer the playground
doesn't have:

| | Firecrawl `/search` playground | **widen** |
|---|---|---|
| Calls per query | one `/search`, one ranking | a **fan-out** of ~24 probes (reformulation · source-type · time · region · niche), merged + deduped |
| The flags | knobs on a single shot | knobs on the **whole fan-out** |
| "How complete was it?" | not answered | **Chao1 recapture estimate, saturation curve, thin/moderate/saturated verdict** |
| Ranking | Firecrawl's per-query order | **cross-probe RRF + BM25 + MMR** over the merged set (eval-tuned) |
| Knowing when to stop | manual | **adaptive saturation stop** |
| Long tail | you hunt for it | **niche-domain forcing + single-probe (★) surfacing + provenance** |
| Scale | one query at a time | **batch** (thousands/night) → JSON artifacts + per-call **observability** |

So the shared flags are not the overlap that worries me — they're the *inputs* to
the missing completeness layer. The playground is the **primitive**; widen is the
**thin layer on top** the brief asked for, and the one that actually answers
*"how many sources did we miss?"* — a question a single `/search` structurally
cannot.

### How it works
```
query ─▶ expand ─▶ fan-out ─▶ merge/dedup ─▶ coverage report ─▶ artifact (JSON)
```
- **Expand** — one query becomes ~19 prioritized probes across five axes: the
  untouched *base*, *reformulations* (facets), *source-type* (news vertical,
  research/pdf categories, forum/blog operators), *time* windows (`tbs`), and a
  *region* sweep (`location`). All deterministic, so it runs with **only a
  Firecrawl key**. An optional `--llm` flag adds model-generated reformulations
  (local Ollama by default; one env var swaps to Anthropic) — and the LLM *only*
  proposes query strings, never request params, so a hallucination can at worst
  add a weak query, never malform a call.
- **Fan-out** — probes run concurrently in waves with retries, exponential
  backoff, and a hard per-probe timeout. Failures are classified
  (`rate-limited` / `timeout` / `error`) and surfaced individually — never
  collapsed into one opaque error.
- **Merge** — conservative URL canonicalization (strip tracking params, www,
  fragments; never collapse distinct paths) with full **provenance**: which
  probes found each source.
- **Rank** — on by default (`--no-rerank` for raw discovery order).

  **Why re-rank lists that are already ranked?** Because after fan-out there is
  *no single ranked list to keep* — there are ~20, one per probe, each ranked for
  a *different* query variant, and merging+dedup destroys their per-list order (a
  source at rank 3 in probe A and rank 9 in probe B has no global rank). We must
  *construct* the one global order, and the order we want is not the one
  Firecrawl optimizes for: its per-list ranking favors generic popularity — the
  "same SEO winners" the customer is complaining about. So ranking here does
  three things no single Firecrawl list does: reward **cross-probe agreement**,
  re-ground to the **original query**, and inject **source diversity**.

  - **Relevance — one RRF fusion, not a weighted blend.** BM25 *is itself a
    ranking*, so it doesn't get score-averaged with RRF (averaging incomparable
    score scales is the exact sin RRF exists to avoid). The relevance score is
    **one Reciprocal Rank Fusion** over each probe's list plus **one more list
    from BM25** of title+snippet vs the *original* query — RRF needs only ranks,
    the right tool *because Firecrawl returns ranks, not scores* (confirmed in the
    SDK types). The BM25 list re-grounds relevance after probe drift. How many
    "votes" it gets is **set by evaluation, not guessed**: every probe counts as
    1, BM25 as **12** — the nDCG winner (below). Not a customer knob.
  - **Diversity — MMR** with the standard objective: `argmax λ·Rel(d) −
    (1−λ)·max sim(d, chosen)`, `λ = 1−diversity`, where similarity is **cosine
    over tf-idf vectors** of title+snippet (Carbonell & Goldstein 1998) — the
    textbook MMR similarity, no domain heuristics, no tuned constants. MMR's
    similarity *is* the diversity mechanism (not a second discount); its `max`-
    over-selected form gives a cluster's **first/best item full credit** while
    near-duplicates are demoted and out-competed. The **`--diversity` flag (0–1,
    default 0.45)** is the single intentional knob: 0 = rank the obvious best,
    1 = maximize spread. A **`--min-relevance`** filter can drop sub-threshold
    sources from the *displayed* list (coverage is still computed on everything
    found, so the completeness story stays honest).
- **Coverage** — the trust artifact (below).
- **Adaptive stop** — keep probing until new domains stop appearing
  (`saturated`), the budget is hit (`budget-exhausted`), or candidates run out.
  Knowing when to stop is reported, not hidden.

### The trust artifact: how complete *was* it?
- **Saturation curve** — cumulative unique domains per probe. Still climbing =
  more to find; flat tail = saturated.
- **Chao1 capture–recapture estimate** — borrowed from ecology. A domain found
  by only *one* probe (a singleton) is evidence that similar domains exist but
  weren't hit. From singleton/doubleton counts, Chao1 estimates total
  *discoverable* domains, so we can say **"~18% of discoverable sources found"**
  instead of pretending the list is complete. It's an estimate, and the report
  says so.
- **Diversity** — domains per axis (proves the long tail came from *widening*,
  not depth), top-5 concentration, source-type split.
- **Verdict** — `thin` / `moderate` / `saturated`, each with a one-line reason.
  Thin coverage is stated loudly, not buried.
- **Per-phase timing (observability)** — every run records wall-clock for expand
  / fan-out / merge / coverage / rank, plus each Firecrawl `/search` call's
  latency, surfaced in a hidden-by-default panel (and one CLI line). It shows
  clients where the budget goes — fan-out (network) dominates; the local steps,
  including BM25 + tf-idf MMR, are single-digit-to-tens of ms (tf-idf is
  classical IR over this run's result set, not an LLM context — cheap by
  construction).

### Verified, not asserted
`npm run eval` runs the customer's exact baseline — one `/search` at `limit 50` —
against the full fan-out and reports **net-new domains** the deep single ranking
never returned. On a smoke run for *"solid state battery suppliers"* (6 probes,
deliberately under-budget), the fan-out surfaced exactly the long tail the
customer means: `diysolarforum.com`, `electricunicycle.org`, `carnewschina.com`,
a `mitsui.com` PDF, EU/IEEE primary sources — and honestly flagged itself **thin
(18%)** because 6 probes isn't enough. That honesty *is* the feature.

`npm run eval:rank` is how the ranking defaults are **chosen, not guessed** — and
how the *quality of the judge* changed the answer. It fetches each topic's merged
pool, has an LLM grade every pooled result's relevance (0–3) to the original
query, and scores each ordering strategy by **nDCG@10** while sweeping the BM25
fusion weight.

**The judge mattered as much as the metric.** A first pass with a local model
(`deepseek-r1:14b`) graded almost everything alike — nDCG barely separated the
strategies and even suggested BM25 *hurt*. Re-running with a **more capable judge,
`claude-opus-4-8`** (the Anthropic key is used here, off the serving path),
produced graded relevance with real variance (e.g. 0/1/2/3 = `2/14/11/3`) and a
clean, monotonic signal (3 topics, nDCG@10):

```
rrf+bm25@12  0.802   ← best (chosen default)
rrf+bm25@8   0.782
rrf+bm25@3   0.767
rrf+bm25@1   0.741
rrf_only     0.730
bm25_only    0.692
baseline     0.649   ← Firecrawl's own order
```

So the evidence-based decision is the opposite of the weak-judge pass: **BM25
fusion helps, more weight is better (returns flatten past ~8), and the fused
ranking beats Firecrawl's own order.** `DEFAULT_BM25_WEIGHT = 12` is that winner,
not a guess. The lesson is the headline: *a weak evaluator can invert your
conclusion* — the right move was to spend a capable model on the eval, exactly
where the heavy lifting belongs, and keep the cheap local model for the
non-critical expansion path. (Honest caveats remain: 3 topics is directional, and
nDCG scores *relevance only* — it can't credit completeness or the deliberate
relevance-for-diversity trade the `--diversity` knob makes.)

58 unit/integration tests cover the math (Chao1, saturation, dedup, BM25, RRF
fusion, tf-idf cosine, MMR, nDCG, retry classification, adaptive stop) against a
fake client — no network, no credits.

---

## What I deliberately did **not** build

- **No *intent-aware* re-ranking (feedback #5's news/buying/research).** widen
  does rank its fused set (relevance + MMR diversity, above), but per-query
  *intent* ranking — boosting freshness for news, credibility for research,
  comparison pages for buying — is *precision*, a different axis from *coverage*,
  and can't be a blanket default since intent varies per query. The
  relevance+diversity ranking is the right universal default; intent ranking is a
  separate, opt-in feature a reranker would own, and widen's fused set could feed it.
- **No LLM-as-default and no agentic loop.** Reintroducing an opaque
  deep-research agent is the one thing the brief warns against. Determinism is
  the point.
- **No scraping of result pages.** `/search` returns titles+snippets, which is
  all coverage needs. Scraping every result would 10–50× the cost for no recall
  gain — and confirms feedback #4's instinct (snippets-only is right here).
- **No DB, no queue, no auth.** Run artifacts are JSON files on disk; the
  dashboard reads the folder. Anything heavier hasn't earned its place at this
  scope.
- **No anti-bot / proxy work** of any kind (the brief says avoid the arms race).
- **No reliance on a multi-query/batch endpoint** — I checked whether Firecrawl
  could take all the probes in one request and return a fused ranking (it would
  simplify the transport). It can't: the OpenAPI spec types `query` as a single
  string (`maxLength 500`); there is no query array or batch-search call. So
  concurrent one-query-per-probe is the transport, and the cross-query fusion +
  dedup + coverage — the actual hard part — is ours regardless. (Verified against
  the spec, not assumed.)

---

## The judgment call

The hardest call was **resisting the obvious "make it thorough" reflex** —
throwing an LLM agent at the topic and letting it roam. That would have demoed
well and been wrong: unpredictable cost, unreproducible results, and a
re-creation of the very endpoint Firecrawl deprecated. I chose the boring,
defensible thing — a deterministic fan-out whose every probe I can explain in a
live walkthrough — and spent the saved complexity budget on the part that's
actually novel and valuable: **measuring and honestly reporting coverage.** A
search that can say *"I'm only 18% complete, here's why"* is worth more to an
analyst than a longer list that quietly hides the same gap.

---

## One thing an AI tool got wrong (and how I caught it)

**The ranking fusion.** Asked to combine relevance signals, the AI assistant
implemented `relevance = 0.65·normalize(RRF) + 0.35·normalize(BM25)` — normalize
two scores to [0,1] and blend them with hand-picked weights. It looked
reasonable and the tests passed. It is, on inspection, exactly the anti-pattern
**Reciprocal Rank Fusion exists to avoid**: averaging scores from systems whose
scales are incomparable, with magic constants nobody can defend. **The reviewer
caught it** and made two corrections the AI had missed: (1) BM25 *is itself a
ranking*, so it should not be score-blended at all — it should join the RRF
fusion as **one more ranked list**, since RRF needs only ranks; and (2) the one
remaining parameter (how much the BM25 list counts) must be **chosen by
evaluation, not guessed**. The fix folded BM25 into a single RRF over (probe
lists + BM25 list), deleted the `0.65/0.35` constants entirely, and added
`npm run eval:rank` (nDCG@10 with an LLM judge) to set the weight from data — and
that eval, run with a capable `claude-opus-4-8` judge, showed the BM25 fusion
clearly improving the ranking (weight 12 the winner). A reminder that an AI will
happily produce *plausible* ML code that violates the method; catching it took
knowing *why* RRF is used, not just *that* it is.

A second, smaller one (AI-self-caught): the Firecrawl client first pinned the
SDK the model "remembered," `@mendable/firecrawl-js@^1.29.1`. Verifying against
ground truth instead — `npm view` and the *installed* `dist/index.d.ts` — showed
the current package is `firecrawl@4.28.3` with a different shape, where **web
results carry `description` and news results carry `snippet`**. Trusting the
memory would have made `normalizeResults` read the wrong field and silently emit
blank snippets — a bug that passes every test. Fixed by reading the types, and
locked in by `normalizeResults` tests asserting the exact field mapping.

---

## The other feedback — triage & decisions

I solve **one** thing deeply. Here's the reasoning for everything I didn't, using
tier / ARR / trend / leverage and the brief's "is it already solved elsewhere?"
test.

| # | Customer (tier, ARR, trend) | Ask | Decision & why |
|---|---|---|---|
| **1** | Competitive intel (**enterprise, $180k, flat, renewal Q3**) | Search completeness | **BUILT.** Highest strategic leverage: renewal + 3-team expansion, and a genuinely missing thin layer. This repo. |
| 2 | Price comparison (growth, $42k, ↓8%) | BYO residential proxies | **Decline the control, fix the failure.** They *said* they'd rather it "just work." Proxy bursts on one domain → a reliability/proxy-tier fix, not a customer-managed proxy surface (abuse + support cost). Arms-race-adjacent; declining ARR. |
| 3 | OSS user (free) | `dedupe: true` markdown | **Won't build here.** Legit and cheap, but it's a *scrape* output option, not search. Belongs to the scrape team; they already have a workaround. Free tier, low leverage. |
| 4 | Indie dev (hobby, $348, ↑) | "3 results, snippets only, fast" | **Already exists — config, not a feature.** `/search` with `limit:3` and no `scrapeOptions` is exactly this. It's the *precision* end (opposite of `widen`) and validates not force-scraping. Worth a docs example (~4,100 similar accounts). |
| 5 | AI research startup (growth, $36k, ↑14%) | `intent`/rerank parameter | **Partly built.** widen ranks its fused set by relevance (RRF + BM25) with a tunable **`--diversity`** knob (MMR). The per-query *intent* ranking (news/buying/research) stays out of scope — it can't be a blanket default; widen's fused set could feed such a reranker. |
| 6 | Fortune 500 (prospect) | "Understand any website" | **Out of scope; composable today.** RAG over `/search`+`/scrape`+`/extract`; a solutions/agent engagement, not a missing primitive. |
| 7 | Workflow automation (growth, $28k, ↑6%) | Which of 14 actions failed + page state | **Real & high-value, but scrape-side.** Step-index errors + screenshots belong to the actions/scrape team. Ties to the 214 error-confusion tickets — flagged below — but not the search problem. |
| 8 | Startup (growth, $31k, flat) | Tail latency / "know a page is slow upfront" | **Not this surface.** Scrape reliability + observability. |
| 9 | Data infra (growth, $38k, flat) | Self-maintaining extractors | **Out of scope; roadmap-sized.** "Maintains itself" is a managed-extraction product, not a thin layer; partially served by `/extract`. |
| 10 | Sales intel (**scale, $60k, ↑18%**) | LinkedIn profiles at scale | **Decline / route per brief.** Anti-bot arms race; headcount/jobs/profiles are better served via ATS + SEC filings. Real money, wrong path — a deliberate stance, not a gap. |
| 11 | AI agent startup (trial) | Authenticated multi-step sessions + credential handling | **Out of scope.** A browser-session + secrets primitive, not search. |

**GitHub issues (90d), same lens:** *error confusion/debugging (214)* is the
biggest bucket and cross-cuts #7 — `widen` doesn't fix it but **models the right
pattern** (every probe's failure is first-class, never one opaque error).
*search relevance/result count (38)* is my pick's territory: `widen` owns the
*completeness* half; the *relevance* half is #5. *scrape failures on protected
sites (96)* and *pdf parsing (27)* are scrape-side / arms-race — out of scope by
the brief. I chose the bucket with the highest strategic leverage I could solve
**deeply** in three days where a thin, genuinely-missing layer exists.

---

## Setup (one step) & usage

```bash
# 1. one-time
cp .env.example .env        # add your FIRECRAWL_API_KEY (the only required input)
npm install

# 2. run a search (CLI — the primary surface)
npm run widen -- search "solid state battery suppliers"
npm run widen -- batch examples/queries.txt --budget 24   # overnight-job shape
npm run widen -- list                                      # browse past runs

# 3. the dashboard (reads the same runs/ folder; can run searches ad hoc)
npm run web                 # http://localhost:3939

# 4. the verifiable claims
npm run eval         # completeness: baseline limit=50 vs the fan-out (net-new domains)
npm run eval:rank    # ranking: nDCG@10 across strategies (LLM judge); picks the BM25 weight

# tests / typecheck
npm test && npm run typecheck
```

`--diversity <0..1>` (default 0.45) is the one ranking knob exposed to users; the
relevance fusion (RRF + BM25 weight) is internal and set by `eval:rank`, so the
customer gets a sensible default, not a pile of switches.

Optional LLM-enhanced expansion: `npm run widen -- search "…" --llm` (defaults to
local Ollama at `localhost:11434`; set `LLM_PROVIDER=anthropic` + `ANTHROPIC_API_KEY`
to use Claude). It's strictly additive — everything works without it.

## Honest limitations
- Chao1 assumes probes sample somewhat independently; heavily-overlapping probes
  bias the estimate optimistically. The report shows singleton/doubleton counts
  so you can judge it, and we never claim it's exact.
- Dedup is URL-level, not semantic; the same article syndicated under two URLs
  counts twice (deliberately — over-merging hides real sources).
- Stack: TypeScript end-to-end (shared core for CLI + dashboard), official
  `firecrawl` SDK, official `@anthropic-ai/sdk` for the eval judge, Next.js +
  Tailwind + shadcn/ui for the dashboard, zero database (runs are JSON files).
  Each chosen as the lightest thing that does the job.
- The eval judge (`claude-opus-4-8`) is the only paid LLM and runs **off the
  serving path** — the search itself needs nothing beyond a Firecrawl key; the
  optional `--llm` expansion defaults to a free local Ollama model.
