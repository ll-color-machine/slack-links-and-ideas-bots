const fs = require("fs");
const llog = require("learninglab-log");
const { normalizeTopic, normalizeStudyType } = require("./normalize");
const { z } = require("zod");
const { zodTextFormat } = require("openai/helpers/zod");

// Zod schema for structured outputs → aligns with Airtable PDFs fields
function buildPdfMetadataZod() {
  return z.object({
    title: z.string().min(1, "title required"),
    year: z.number().int().gte(1900).lte(2099).nullable(),
    topic: z.enum([
      "Learning outcomes",
      "Tool development",
      "Professional practice",
      "Student perspectives",
      "User experience and interaction",
      "Theoretical background",
      "AI literacy",
      "Other",
    ]).nullable(),
    study_type: z.enum(["Review", "Experimental", "Quantitative", "Qualitative", "Mixed-methods", "Observational"]).nullable(),
    // OpenAI structured outputs currently rejects format: 'uri'.
    // Use plain string and validate downstream if needed.
    link: z.string().min(1).nullable(),
    summary: z.string().min(1, "summary required"),
  });
}

// Analyze the PDF via OpenAI Responses API using Structured Outputs
async function analyzePdfWithOpenAI(openai, pdfPath) {
  try {
    llog.yellow("🤖 Uploading PDF to OpenAI using Responses API...");
    const upload = await openai.files.create({ file: fs.createReadStream(pdfPath), purpose: "user_data" });

    const summaryPrompt = `Extract bibliographic and topical metadata and a summary for the attached PDF.\n\nRequirements for the summary field:\n- Write approximately three paragraphs.\n- Each paragraph should be 4–6 sentences.\n- Separate paragraphs with a blank line.\n- Be clear and specific; avoid generic filler.\n\nReturn a JSON object that matches the provided schema exactly.`;

    const model = process.env.OPENAI_PDF_MODEL || process.env.OPENAI_MODEL || "gpt-5";
    const PdfMetadata = buildPdfMetadataZod();
    llog.yellow(`🎯 Using model for structured output: ${model}`);
    let response = await openai.responses.parse({
      model,
      input: [{
        role: "user",
        content: [
          { type: "input_file", file_id: upload.id },
          { type: "input_text", text: summaryPrompt },
        ],
      }],
      text: { format: zodTextFormat(PdfMetadata, "PdfMetadata") },
    });
    try {
      llog.cyan("🧪 OpenAI structured output (parsed)");
      llog.blue(response?.output_parsed || null);
      const raw = response?.output_text || "";
      if (raw) {
        llog.darkgray("🧪 OpenAI output_text preview (first 600 chars)");
        llog.gray(String(raw).slice(0, 600));
      }
    } catch (_) {}
    llog.green(`✅ Structured parse succeeded: ${model}`);

    // Best-effort cleanup
    try { await openai.files.del(upload.id); } catch {}

    const responseText = response?.output_text || "";
    const parsed = response?.output_parsed || null;
    if (!parsed) {
      llog.yellow("⚠️ No structured parsed output; using text fallback");
      if (responseText) llog.gray(String(responseText).slice(0, 600));
    }
    return { success: true, model, responseText, parsed };
  } catch (e) {
    llog.red(`OpenAI API Error: ${e}`);
    return { success: false, error: String(e) };
  }
}

// Map either parsed structured output or fallback text into our metadata shape
function extractMetadataFromResponse(text, fallbackTitle = "Untitled", parsed = null) {
  if (parsed && typeof parsed === 'object') {
    return {
      title: parsed.title || fallbackTitle,
      topic: normalizeTopic(parsed.topic || 'Other'),
      study_type: normalizeStudyType(parsed.study_type || 'Review'),
      year: typeof parsed.year === 'number' ? parsed.year : undefined,
      link: parsed.link || undefined,
      summary: parsed.summary || '',
    };
  }
  const summary = text?.trim() || "No summary available.";
  return { title: fallbackTitle, topic: "Other", study_type: "Review", year: undefined, link: undefined, summary };
}

module.exports = { analyzePdfWithOpenAI, extractMetadataFromResponse };
