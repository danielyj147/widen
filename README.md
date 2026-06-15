# The brief

You're a product engineer at Firecrawl. Below are 11 pieces of customer feedback from the last month. Most are excerpts from recorded customer calls, plus two Discord threads and a GitHub issue. Lightly edited for length, otherwise as we got them. This is the actual job: most weeks you'll be on calls like these, deciding what they mean for the product.

Your job:

1. Read all 11. Decide what matters most. You can't do everything, that's the point.
2. Build a working demo using Firecrawl that addresses what you picked. A dashboard, an API, a CLI, an agent, your call. It should be a real product surface someone could actually use, not a script that prints JSON. Expect to compose more than one Firecrawl capability, or handle the messy parts properly: failures, retries, slow pages, empty results. Any language, any stack.
3. Write one page: what you built, what you deliberately didn't build, and why. Include one thing your AI tools got wrong along the way and how you caught it.

One warning: some of what these customers ask for already exists. Know the product before you build. Make sure you're not making something we already have.

On AI: we highly encourage you to build with AI tools. We do, all day. But you own everything you ship. In the call we expect you to explain what was built, how it works, and why you made each call. If you can't walk us through your own code, it doesn't count as yours.

There's also a `data/` folder with some internal numbers we pulled: support ticket categories from the last 90 days and account info for the customers quoted below. Use it however you like.

You have 72 hours from receiving this repo to finish your project. Let us know if you need more Firecrawl credits.

When you're done, reply with a link to a public repo containing your demo and the one-pager. Two deadlines, whichever comes first: within the 72 hours, and at least 24 hours before your scheduled call. We read your submission before we talk. Public repo means public: make sure your API key isn't in the code or the git history.

Then we do a 45-min call: you demo it live and we dig into the implementation. What you built, how it works, why you made each call. If it can't be explained and demoed in that call, it's too big.

We care about what you chose and why. Narrow and deep beats wide and shallow: one real problem, solved properly, beats touching everything a little.

---

## The feedback

**1. Call excerpt — quarterly check-in, competitive intelligence platform, enterprise plan, renewal in Q3**

> **Customer (Head of Research):** The landscape reports go straight to our clients, so completeness is the product. We already run your search with the limit at fifty, and my analysts still find sources by hand afterward that it never surfaced. Trade pubs, regional press, niche forums.
> **Firecrawl:** So it's not the number of results.
> **Customer:** No. Going from ten to fifty mostly gave us forty more of the same SEO winners. The sources we actually miss don't show up at any limit. We used your deep research endpoint for a while, which was closer to right, but it seems like you deprecated it.
> **Firecrawl:** Would more thorough be worth slower to you?
> **Customer:** These run overnight as batch jobs, a few thousand queries a night. Nobody is watching a spinner. Make it ten times slower, I genuinely don't care. I need it before we expand this to the other two teams, and that conversation is happening this quarter.

**2. Call excerpt — escalation call, price comparison service, growth plan**

> **Customer (CTO):** Three weeks now, scrapes against one of the big retail domains fail about half the time. Every other domain is fine.
> **Firecrawl:** What have you tried so far?
> **Customer:** waitFor up to fifteen seconds, mobile on, mobile off. No difference. We keep proxy pinned to basic, by the way; at our volume the enhanced pricing would blow up the bill. The failures come in bursts, which to us says your datacenter IPs are getting flagged. So here's what we want: let us plug in our own residential proxies. We've run our own proxy infra before, we know what we're doing, and we know what it costs.
> **Firecrawl:** If the bursts theory is right, would you rather we just made the failures go away, or do you specifically want the proxy controls?
> **Customer:** Honestly we assumed making it go away wasn't on the table. We've been planning around doing it ourselves.

**3. GitHub issue — open source user**

"**Feature request: `dedupe` option for markdown output**

On long e-commerce product pages, the same content block shows up two or three times in the markdown. Typically the product description: once from the main body, then again from what I assume is a mobile or footer variant of the same section. Page renders fine in a browser, no visible duplication.

Repro: happens consistently on product pages across two different store platforms we cover (can share URLs privately). Affects maybe 15-20% of our catalog pages.

We've already built a post-processing step that fingerprints paragraphs and strips repeats, so this isn't blocking us. But it's extra code we maintain and it occasionally eats a legit repeated disclaimer. We'd drop the whole thing the day you ship `dedupe: true`."

**4. Discord — indie dev, hobby plan**

"ok so I'm building a discord bot that answers questions with live web context. my entire latency budget is like 1.5s before the convo feels dead. /search is eating most of that and returning 10 results with full page content when I literally use the top 3 titles + snippets

I'm now parsing a wall of json, throwing away 80% of it, every single call. feels like paying for a buffet to eat the breadsticks. is there a 'just give me 3 results, snippets only, fast' mode that I'm missing? if not, consider this my feature request lol"

**5. Call excerpt — monthly check-in, AI research assistant startup, growth plan**

> **Customer (ML Lead):** Search results come back in an order that makes sense for a generic search engine, not for us. Our users ask buying questions, comparison questions, news questions. Each of those wants a different ranking. Today we pull thirty results and rerank everything ourselves on our side.
> **Firecrawl:** What does your rerank look at?
> **Customer:** Depends on the query type. Freshness for news. Domain credibility for research. For buying intent we boost pages that actually compare products. We built a whole classification and rerank pipeline that we'd rather not own.
> **Firecrawl:** So what's the ask, exactly?
> **Customer:** Let us tell search what we care about. A rerank parameter where we pick the criteria, or even just an intention field, like "news" or "buying research", and you order results for that. You have the content already, you're in a better position to rank it than we are.

**6. Call excerpt — discovery call, Fortune 500, net-new (AE brought product along)**

> **Customer (VP Innovation):** The vision is simple. Our internal assistant should understand any website we point it at. We don't want to think about scraping. We want the AI to just understand the website.
> **Firecrawl:** When you say any website, what's the actual range?
> **Customer:** Public docs sites. Supplier portals. Some of our own intranet, eventually. The team has a list, it grows every week.
> **Firecrawl:** And what does "understand" mean for the first use case?
> **Customer:** Ask it a question, get a correct answer with a source. Look, I'll be straight with you: procurement needs a feasibility yes or no this quarter, and this is a seven-figure engagement over three years. What do you need from us to get to yes?

**7. Call excerpt — debugging call, workflow automation startup, growth plan**

> **Customer (Senior Engineer):** We scrape a vendor dashboard that needs setup before the content exists. Our actions array is up to fourteen steps now. Click, wait, fill, click, scroll, a couple of executeJavascript steps, more waits.
> **Firecrawl:** That's a serious sequence.
> **Customer:** It works, mostly. But when it breaks, the whole thing comes back as one SCRAPE_FAILED. Fourteen steps, one error. Was it step three or step eleven? Did a selector miss, did a wait time out, did the page change on us? We re-run the entire chain with screenshots sprinkled in just to find out where it died. Re-run and squint, that's our debugging strategy.
> **Firecrawl:** What would good look like?
> **Customer:** Tell me which step failed and what the page looked like when it did. Honestly, even just the step index would cut our debugging time in half.

**8. Discord — startup on growth plan**

"scrape latency question. p50 is great, ~2s, no complaints. but a few times a week a single request just hangs and comes back in 40s+. our product calls firecrawl inline when a user pastes a link, so when it happens the user is staring at a spinner. we wrapped everything in a 10s client timeout, which 'fixes' it by turning your slow responses into our errors lol. happened 3x this week that I noticed. is this expected? is there a pattern to which pages do this? would love either faster tails or a way to know upfront that a page will be slow"

**9. Call excerpt — quarterly review, data infrastructure company, growth plan**

> **Customer (Data Platform Lead):** We run forty-some extraction jobs on you now. Every one is a prompt and a schema somebody on my team wrote, and every one needs babysitting. Sites change, extractions drift, and we usually find out a week later when someone notices the data went stale.
> **Firecrawl:** What does the maintenance actually cost you?
> **Customer:** Roughly one engineer's Fridays, forever. What I keep wishing for: we describe what we want once, and keeping it working is your problem. Ready-made extractors, managed collectors, whatever you want to call the shape. We'd pay real money to stop owning the upkeep.
> **Firecrawl:** So if you could describe the data in a sentence and get back working code that maintains itself...
> **Customer:** Yes. That. Especially the maintains-itself part. Does that exist?

**10. Call excerpt — expansion call, sales intelligence platform, scale plan**

> **Customer (Head of Data):** Our enrichment pipeline runs on you for company websites and it's been great. Now we want the other half: LinkedIn. Profiles, company pages, headcount, job changes. Structured JSON out, same as everything else we do with you.
> **Firecrawl:** What have you tried?
> **Customer:** Pointing scrape at LinkedIn URLs. Everything fails, and the errors look different from normal sites. We figured it's an anti-bot problem you're still cracking.
> **Firecrawl:** LinkedIn specifically is a hard one for us.
> **Customer:** So crack it. Whatever tier that takes. We pay a LinkedIn data vendor more today than our entire Firecrawl bill. Get us profiles at scale and that whole budget moves to you. I'm telling you there's real money here.

**11. Call excerpt — technical evaluation call, AI agent startup, trial plan**

> **Customer (CTO):** The workflow is: our agent logs into a customer's vendor portal, credentials are per-customer, navigates two or three pages of menus, and extracts a table that only exists behind that login. No human in the loop. About five hundred runs a day across customers.
> **Firecrawl:** What's it running on today?
> **Customer:** Our own Playwright cluster, and it's a maintenance nightmare. Selectors rot, sessions expire mid-run, captchas show up. Two of my six engineers basically do nothing else.
> **Firecrawl:** What would you need to see to move it over?
> **Customer:** Three answers. Can you hold an authenticated session across multiple steps? How do you want us to handle credentials, because we are not putting customer passwords in a prompt. And what happens when a login fails halfway through a run? Show me those three and we move everything.
