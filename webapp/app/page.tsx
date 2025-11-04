"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";

type Headline = {
  title: string;
  link: string;
  publishedAt: string;
  description: string;
};

type GenerationStatus = "idle" | "fetching" | "rendering" | "done" | "error";

const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 720;

const STATUS_LABELS: Record<GenerationStatus, string> = {
  idle: "वीडियो बनाने के लिए नीचे क्लिक करें",
  fetching: "ताज़ा सुर्ख़ियाँ इकट्ठा की जा रही हैं…",
  rendering: "वीडियो तैयार किया जा रहा है…",
  done: "वीडियो तैयार है!",
  error: "कुछ गड़बड़ हो गई। दोबारा प्रयास करें।",
};

function formatToHindiDate(value: string) {
  if (!value) return "समय उपलब्ध नहीं";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "समय उपलब्ध नहीं";

  return new Intl.DateTimeFormat("hi-IN", {
    dateStyle: "full",
    timeStyle: "short",
    hour12: true,
  }).format(date);
}

function wrapHeadlineText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines = 6,
) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return y;

  const words = normalized.split(" ");
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const testLine = line ? `${line} ${word}` : word;
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = testLine;
    }
  }

  if (line) {
    lines.push(line);
  }

  const limit = Math.max(1, Math.floor(maxLines));
  const boundedLines = lines.slice(0, limit);

  if (lines.length > limit) {
    let lastLine = boundedLines[boundedLines.length - 1] ?? "";
    while (ctx.measureText(`${lastLine}…`).width > maxWidth && lastLine.length) {
      lastLine = lastLine.slice(0, -1);
    }
    boundedLines[boundedLines.length - 1] = `${lastLine}…`;
  }

  let currentY = y;
  for (const entry of boundedLines) {
    ctx.fillText(entry, x, currentY);
    currentY += lineHeight;
  }

  return currentY;
}

async function createFrame(
  headline: Headline,
  index: number,
  total: number,
): Promise<{ name: string; data: Uint8Array }> {
  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error("Canvas rendering context unavailable");
  }

  const gradient = ctx.createLinearGradient(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  gradient.addColorStop(0, "#0f172a");
  gradient.addColorStop(1, "#1e293b");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  const overlayGradient = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
  overlayGradient.addColorStop(0, "rgba(15, 23, 42, 0.2)");
  overlayGradient.addColorStop(1, "rgba(8, 47, 73, 0.8)");
  ctx.fillStyle = overlayGradient;
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.font = "600 56px 'Noto Sans Devanagari', 'Hind', sans-serif";
  ctx.fillText("आज की सुर्ख़ियाँ", 80, 140);

  ctx.font = "400 34px 'Noto Sans Devanagari', 'Hind', sans-serif";
  ctx.fillStyle = "rgba(226,232,240,0.96)";
  wrapHeadlineText(ctx, headline.title, 80, 220, CANVAS_WIDTH - 160, 58, 3);

  if (headline.description) {
    ctx.font = "300 28px 'Noto Sans Devanagari', 'Hind', sans-serif";
    ctx.fillStyle = "rgba(203,213,225,0.9)";
    wrapHeadlineText(
      ctx,
      headline.description,
      80,
      420,
      CANVAS_WIDTH - 160,
      46,
      4,
    );
  }

  ctx.font = "500 26px 'Inter', 'Hind', sans-serif";
  ctx.fillStyle = "rgba(148,163,184,0.95)";
  ctx.fillText(
    `${index + 1} / ${total}`,
    CANVAS_WIDTH - 160,
    CANVAS_HEIGHT - 80,
  );

  ctx.font = "400 24px 'Inter', sans-serif";
  ctx.fillText(formatToHindiDate(headline.publishedAt), 80, CANVAS_HEIGHT - 80);

  const dataUrl = canvas.toDataURL("image/png");
  const data = await fetchFile(dataUrl);
  const name = `frame${index.toString().padStart(3, "0")}.png`;

  return { name, data };
}

export default function Home() {
  const [headlines, setHeadlines] = useState<Headline[]>([]);
  const [status, setStatus] = useState<GenerationStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const ffmpegRef = useRef<FFmpeg | null>(null);
  const videoUrlRef = useRef<string | null>(null);
  const progressHandlerRef = useRef<
    ((event: { progress?: number }) => void) | null
  >(null);

  useEffect(() => {
    return () => {
      if (videoUrlRef.current) {
        URL.revokeObjectURL(videoUrlRef.current);
      }
      if (ffmpegRef.current && progressHandlerRef.current) {
        ffmpegRef.current.off("progress", progressHandlerRef.current);
      }
    };
  }, []);

  const ensureFfmpeg = useCallback(async () => {
    if (!ffmpegRef.current) {
      const instance = new FFmpeg();
      const handler = ({ progress: raw }: { progress?: number }) => {
        if (typeof raw === "number") {
          setProgress(Math.min(100, Math.round(raw * 100)));
        }
      };
      instance.on("progress", handler);
      progressHandlerRef.current = handler;
      ffmpegRef.current = instance;
    }

    if (!ffmpegRef.current.loaded) {
      await ffmpegRef.current.load();
    }

    return ffmpegRef.current;
  }, []);

  const cleanupFfmpegFiles = useCallback(async (ffmpeg: FFmpeg) => {
    try {
      const entries = await ffmpeg.listDir("/");
      await Promise.all(
        entries
          .filter(
            (entry) =>
              !entry.isDir &&
              (entry.name.startsWith("frame") || entry.name === "output.mp4"),
          )
          .map(async (entry) => {
            try {
              await ffmpeg.deleteFile(entry.name);
            } catch {
              // ignore deletion errors
            }
          }),
      );
    } catch {
      // directory listing might fail the first time before load completes.
    }
  }, []);

  const handleGenerate = useCallback(async () => {
    setError(null);
    setVideoUrl(null);
    if (videoUrlRef.current) {
      URL.revokeObjectURL(videoUrlRef.current);
      videoUrlRef.current = null;
    }
    setProgress(0);
    setStatus("fetching");
    setIsGenerating(true);
    setProgress(5);

    try {
      const response = await fetch("/api/headlines", { cache: "no-store" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error ?? "Headlines fetch failed");
      }

      const payload: { headlines?: Headline[] } = await response.json();
      const fetched = Array.isArray(payload.headlines) ? payload.headlines : [];

      if (!fetched.length) {
        throw new Error("आज के लिए कोई सुर्ख़ियाँ उपलब्ध नहीं हैं।");
      }

      setHeadlines(fetched);
      setStatus("rendering");
      setProgress(15);

      const ffmpeg = await ensureFfmpeg();
      await cleanupFfmpegFiles(ffmpeg);

      const frames = await Promise.all(
        fetched.map((item, index) => createFrame(item, index, fetched.length)),
      );

      setProgress(40);

      for (const frame of frames) {
        await ffmpeg.writeFile(frame.name, frame.data);
      }

      setProgress(55);

      await ffmpeg.exec([
        "-framerate",
        "1/3",
        "-start_number",
        "0",
        "-i",
        "frame%03d.png",
        "-c:v",
        "libx264",
        "-r",
        "30",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        "output.mp4",
      ]);

      setProgress(85);

      const data = await ffmpeg.readFile("output.mp4");
      const binary =
        data instanceof Uint8Array
          ? data
          : typeof data === "string"
            ? new TextEncoder().encode(data)
            : new Uint8Array();
      const videoBuffer = new ArrayBuffer(binary.byteLength);
      const view = new Uint8Array(videoBuffer);
      view.set(binary);
      const blob = new Blob([videoBuffer], { type: "video/mp4" });
      const objectUrl = URL.createObjectURL(blob);
      videoUrlRef.current = objectUrl;
      setVideoUrl(objectUrl);
      setProgress(100);
      setStatus("done");
    } catch (err) {
      console.error(err);
      setError(
        err instanceof Error ? err.message : "कुछ गलत हुआ, कृपया पुनः प्रयास करें।",
      );
      setStatus("error");
    } finally {
      setIsGenerating(false);
    }
  }, [cleanupFfmpegFiles, ensureFfmpeg]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 py-10 text-slate-100">
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6">
        <header className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur">
          <p className="text-sm font-semibold uppercase tracking-[0.35em] text-emerald-400">
            समाचार वीडियो
          </p>
          <h1 className="text-4xl font-semibold leading-tight md:text-5xl">
            आज की सुर्ख़ियों पर आधारित वीडियो कुछ ही सेकंड में जनरेट करें।
          </h1>
          <p className="max-w-2xl text-lg text-slate-300">
            यह टूल इंटरनेट से ताज़ा शीर्ष समाचार सुर्ख़ियाँ लाता है और उनके
            आधार पर एक वीडियो तैयार करता है जिसे आप डाउनलोड करके साझा कर सकते हैं।
          </p>
          <div className="flex flex-col gap-4 md:flex-row md:items-center">
            <button
              onClick={handleGenerate}
              disabled={isGenerating}
              className="inline-flex w-full items-center justify-center rounded-full bg-emerald-500 px-6 py-3 text-lg font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60 md:w-auto"
            >
              {isGenerating ? "वीडियो तैयार हो रहा है..." : "आज का वीडियो बनाएं"}
            </button>
            <div className="flex-1 text-sm text-slate-300">
              {STATUS_LABELS[status]}
              {isGenerating && (
                <span className="ml-2 inline-flex items-center gap-2">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-300" />
                  {progress}%
                </span>
              )}
            </div>
          </div>
          {error && (
            <p className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">
              {error}
            </p>
          )}
        </header>

        {headlines.length > 0 && (
          <section className="grid gap-4 md:grid-cols-2">
            {headlines.map((headline, index) => (
              <article
                key={`${headline.title}-${index.toString()}`}
                className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur"
              >
                <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-[0.3em] text-emerald-300">
                  <span>ख़बर #{index + 1}</span>
                  <span>{formatToHindiDate(headline.publishedAt)}</span>
                </div>
                <h2 className="text-xl font-semibold text-slate-100">
                  {headline.title}
                </h2>
                {headline.description && (
                  <p className="text-sm leading-relaxed text-slate-300">
                    {headline.description}
                  </p>
                )}
                {headline.link && (
                  <a
                    href={headline.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-300 hover:text-emerald-200"
                  >
                    पूरी खबर पढ़ें →
                  </a>
                )}
              </article>
            ))}
          </section>
        )}

        {videoUrl && (
          <section className="flex flex-col gap-6 rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur">
            <h2 className="text-2xl font-semibold text-slate-100">
              जनरेट किया गया वीडियो
            </h2>
            <video
              className="w-full rounded-2xl border border-white/10 bg-black/60"
              controls
              src={videoUrl}
            />
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <p className="text-sm text-slate-300">
                यह वीडियो 720p रिज़ॉल्यूशन में तैयार किया गया है। आप इसे डाउनलोड
                करके सोशल मीडिया पर साझा कर सकते हैं।
              </p>
              <a
                href={videoUrl}
                download="aaj-ki-headlines.mp4"
                className="inline-flex items-center justify-center rounded-full border border-emerald-300 px-5 py-2 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-400 hover:text-slate-950"
              >
                वीडियो डाउनलोड करें
              </a>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
