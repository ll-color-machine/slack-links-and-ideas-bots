Nice scrape! You’re pulling a lot of useful metadata already. The extra “noise” you’re seeing is because arXiv’s `/abs` page mixes the abstract with a ton of site chrome (labs widgets, recommenders, etc.). There are a few clean ways to separate “article/main text” from the boilerplate:

---

### Option A (fastest): Domain-specific extractor for arXiv

For `arxiv.org/abs/*`, you can reliably grab just the pieces you care about:

* Title → `#abs > h1.title` (strip the leading `Title:` span)
* Authors → `#abs > div.authors`
* Abstract → `#abs > blockquote.abstract`
* Subjects → `#abs > div.metatable` (or parse “Subjects:” line)
* PDF URL → meta `citation_pdf_url` (you already capture this)
* Submission history → `#abs > div.submission-history`

**Minimal Node/cheerio post-processor (run after Firecrawl returns HTML):**

```js
import cheerio from "cheerio";

export function extractArxivMain(html) {
  const $ = cheerio.load(html);

  // Prefer the “abs” container if present.
  const $abs = $("#abs");
  if ($abs.length === 0) return null;

  const title = $abs.find("h1.title").text().replace(/^Title:\s*/i, "").trim();
  const authors = $abs.find("div.authors").text().replace(/^Authors?:\s*/i, "").trim();
  const abstract = $abs.find("blockquote.abstract").text().replace(/^Abstract:\s*/i, "").trim();
  const subjects = $abs.find(".subheader, .metatable").text().match(/Subjects?:\s*(.+)/i)?.[1]?.trim();

  // Prefer meta tag for the PDF if present.
  const pdfUrl = $('meta[name="citation_pdf_url"]').attr("content")
               || $('a[accesskey="f"]').attr("href");

  // Pack a minimal “main article” record
  return {
    source: "arxiv",
    title,
    authors,
    abstract,
    subjects,
    pdfUrl: pdfUrl && pdfUrl.startsWith("http") ? pdfUrl : (pdfUrl ? `https://arxiv.org${pdfUrl}` : null)
  };
}
```

If `extractArxivMain` returns data, store that as your “main\_text” (or separate fields) and **skip** the rest of the page furniture.

---

### Option B (generic): Run a Readability-style “main article” parser

For non-arXiv pages (and as a fallback), plug in a boilerplate remover such as **Mozilla Readability** (open-source, battle-tested) over the HTML Firecrawl gives you.

**Example (Node, JSDOM + Readability):**

```js
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

export function extractMainArticle(html) {
  const dom = new JSDOM(html, { url: "https://example.com/" });
  const reader = new Readability(dom.window.document, {
    // optional tweaks:
    // charThreshold: 500, // minimum length
    // keepClasses: false
  });
  const article = reader.parse(); // { title, byline, content (HTML), textContent, length, excerpt }
  return article; // null if it fails to find a main block
}
```

Then prefer `article.textContent` (or `article.content` if you want HTML→Markdown later) over the raw page. You can run this **after** your domain-specific step so arXiv stays precise while everything else gets a generic “article” treatment.

---

### Option C (best for papers): PDF-first pipeline when `citation_pdf_url` exists

For scholarly sites (arXiv, ACM, Springer, etc.), the real “main text” is the PDF. When you see `citation_pdf_url`:

1. Fetch the PDF.
2. Extract text (or structure) with a PDF tool:

   * **Quick**: `pdfminer.six` / `PyMuPDF` / `pdftotext` (text only)
   * **Structured**: **GROBID** (sections, references, authors), **ScienceParse**, **Cermine** (heavier but far cleaner for papers)
3. Store fields: `abstract` (from HTML/meta), `sections` (from PDF), `references` (from GROBID if available).

**A pragmatic heuristic:**

* If PDF text length > threshold (e.g., 5k chars) → treat PDF as the main body and the abstract page as metadata.
* Else, fall back to Option A/B.

---

### (If your crawler supports it) CSS allow/deny lists

Some crawlers let you pass selector rules. If Firecrawl gives you an “include/exclude selectors” hook, you can do:

**Allow list (arXiv abs):**

```
#abs h1.title,
#abs div.authors,
#abs blockquote.abstract,
#abs .subheader,
#abs .metatable,
#abs .submission-history
```

**Exclude list (arXiv chrome/common boilerplate):**

```
#header, #footer, .extra-services, .labs-html, .sidebarnav, #abs ~ *,
#comments, #trackbacks, .social, .search-form, .mobile-banners, .nav,
[aria-label*="Recommender"], [data-component*="recommender"]
```

If Firecrawl doesn’t expose selector filters, just run the filters in your **post-processing** step with cheerio (Option A).

---

### End-to-end decision flow

1. **Detect domain**

   * `hostname.endsWith("arxiv.org")` and `pathname.startsWith("/abs/")` → run **Option A**.
2. **Check for `citation_pdf_url`**

   * If present → run **Option C** (PDF-first). Keep the HTML abstract as metadata.
3. **Else**

   * Run **Option B** Readability on the HTML to get main article text.

Persist along with provenance:

```json
{
  "extraction_method": "arxiv-abs | pdf-grobid | readability",
  "fields_present": ["title", "authors", "abstract", "pdfUrl", "main_text", "sections"],
  "raw_html_saved": true
}
```

---

### Airtable tweaks (so your pipeline stays tidy)

Add columns (if you haven’t already):

* `extraction_method` (single select: `arxiv-abs`, `pdf-quick`, `pdf-grobid`, `readability`, `raw`)
* `main_text` (long text) — normalized “article body”
* `abstract` (long text)
* `pdf_url` (URL)
* `sections_json` (long text / JSON)
* `tokens_main_text` (number) — helps trigger fallback if too short
* `dom_excluded_selectors` / `dom_included_selectors` (text) — stored per-domain if useful

---

### Fallback & quality guardrails

* If `main_text` < 1,000 chars and there’s a `citation_pdf_url` → try PDF extraction.
* If Readability returns `null` or very short → try density heuristics:

  * For each `<div>/<p>` block: compute `textLength / (linkCount + 1)` and punctuation ratio. Keep top N blocks with low link density and adequate punctuation.
* De-dupe bylines/boilerplate by removing repeating patterns across multiple pages in the same domain.

---

### Why this works for arXiv specifically

* The **abstract** is the only “article” content on `/abs`. Everything else is navigation, widgets, or links → Option A extracts exactly that.
* The **PDF** is the canonical full text → Option C produces the best “main article” for downstream LLM use (sections, references, etc.).

---

If you want, paste me one Firecrawl HTML payload (or the URL → HTML you store) and tell me your preferred runtime (Node only vs Node+Python). I’ll drop in a plug-and-play post-processor that wires together **A → C → B** and updates your Airtable fields accordingly.
