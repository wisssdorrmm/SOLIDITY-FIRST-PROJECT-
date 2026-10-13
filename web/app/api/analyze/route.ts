// AI packaging check: Claude looks at the pack photo (and reference photos of the
// genuine pack, when we have them) for visible signs of counterfeiting.
import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { findByNafdac, findByText, type ReferenceProduct } from "@/lib/references.ts";
import { clientIp, rateLimit } from "@/lib/rateLimit.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

const RequestSchema = z.object({
  image: z.string().regex(/^data:image\/(jpeg|png|webp);base64,/, "Expected a JPEG, PNG or WebP data URL"),
  ocrText: z.string().max(5000).default(""),
  nafdacNo: z.string().max(32).optional(),
});

const AnalysisSchema = z.object({
  assessment: z.enum(["no_visible_issues", "suspicious", "likely_fake", "unreadable"]),
  findings: z.array(
    z.object({
      severity: z.enum(["red", "amber", "info"]),
      message: z.string(),
    })
  ),
  readText: z.object({
    drugName: z.string().nullable(),
    manufacturer: z.string().nullable(),
    nafdacNo: z.string().nullable(),
    batchNo: z.string().nullable(),
    mfd: z.string().nullable(),
    exp: z.string().nullable(),
  }),
});

const SYSTEM = `You help people in Nigeria spot counterfeit medicine from a photo of the pack.

You will see a photo of a medicine pack, text that phone OCR read from it, and sometimes details and photos of the genuine product from our reference library.

Look for visible signs of counterfeiting:
- spelling or grammar mistakes, wrong or inconsistent fonts, blurry or pixelated printing, misaligned text
- logo, colour or layout that differs from the reference pack, when one is provided
- a missing or oddly printed NAFDAC registration number, batch number, or manufacture and expiry dates
- dates or batch numbers that look overprinted, scratched or stickered over
- a manufacturer name or address that doesn't match the reference
- signs of tampering, damaged seals, or a cheap-looking carton

Rules:
- Never say a pack is genuine or safe. A photo can't prove that: good fakes look perfect. The best result is "no_visible_issues".
- Only report what you can actually see. If the photo is too blurry, dark or cropped to judge, use "unreadable" and say what to rescan.
- Use "red" only for clear signs of counterfeiting, "amber" for things worth checking, and "info" for neutral observations.
- Write findings as short, plain sentences an ordinary shopper understands. Keep it to the 6 most important findings.
- In readText, copy exactly what is printed on the pack, or null if you can't see it.`;

function referenceBlock(refs: ReferenceProduct[]): string {
  if (refs.length === 0) return "No reference product found for this pack.";
  return refs
    .map(
      (r) =>
        `Reference product: ${r.name}
Manufacturer: ${r.manufacturer}
NAFDAC number: ${r.nafdacNo}
Batch number format (regex): ${r.batchPattern ?? "unknown"}
Packaging notes: ${r.packagingNotes ?? "none"}${r.demo ? "\n(This is demo reference data, not a real product.)" : ""}`
    )
    .join("\n\n");
}

type ImageMedia = "image/jpeg" | "image/png" | "image/webp";

function referenceImages(refs: ReferenceProduct[]) {
  const blocks: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const r of refs) {
    for (const file of r.referenceImages.slice(0, 2)) {
      const full = path.join(process.cwd(), "public", "references", path.basename(file));
      if (!fs.existsSync(full)) continue;
      const ext = path.extname(full).toLowerCase();
      const media_type: ImageMedia = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
      blocks.push({ type: "text", text: `Genuine reference photo of ${r.name}:` });
      blocks.push({ type: "image", source: { type: "base64", media_type, data: fs.readFileSync(full).toString("base64") } });
    }
  }
  return blocks;
}

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "AI check is not configured (ANTHROPIC_API_KEY missing)." }, { status: 503 });
  }
  if (!rateLimit(`analyze:${clientIp(req)}`, 20, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many AI checks from this connection. Try again later." }, { status: 429 });
  }

  const parsed = RequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }
  const { image, ocrText, nafdacNo } = parsed.data;
  const [header, data] = image.split(",", 2);
  const media_type = header.slice(5, header.indexOf(";")) as ImageMedia;
  if ((data.length * 3) / 4 > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "Photo is too large (max 4 MB)." }, { status: 413 });
  }

  const refs = [findByNafdac(nafdacNo), ...findByText(ocrText)].filter(
    (r, i, all): r is ReferenceProduct => Boolean(r) && all.indexOf(r) === i
  );

  const client = new Anthropic();
  try {
    const response = await client.beta.messages.parse({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: betaZodOutputFormat(AnalysisSchema) },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            ...referenceImages(refs),
            { type: "text", text: referenceBlock(refs) },
            { type: "text", text: `Text the phone OCR read from the pack (may contain errors):\n${ocrText || "(nothing readable)"}` },
            { type: "text", text: "Photo of the pack being checked:" },
            { type: "image", source: { type: "base64", media_type, data } },
          ],
        },
      ],
    });

    if (response.stop_reason === "refusal" || !response.parsed_output) {
      return NextResponse.json({ error: "The AI check couldn't analyse this photo. Try a clearer photo." }, { status: 422 });
    }
    return NextResponse.json(response.parsed_output);
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: "AI check is busy. Try again in a minute." }, { status: 429 });
    }
    if (err instanceof Anthropic.APIError) {
      console.error(`Claude API error ${err.status}:`, err.message);
      return NextResponse.json({ error: "AI check failed. The other checks still work." }, { status: 502 });
    }
    throw err;
  }
}
