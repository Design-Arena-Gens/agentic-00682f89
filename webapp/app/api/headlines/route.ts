import { NextResponse } from "next/server";
import { XMLParser } from "fast-xml-parser";

type RssItem = {
  title?: string;
  link?: string;
  pubDate?: string;
  description?: string;
};

const NEWS_FEED_URL =
  "https://news.google.com/rss?hl=hi-IN&gl=IN&ceid=IN:hi";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  textNodeName: "text",
  parseAttributeValue: true,
  trimValues: true,
});

function sanitizeText(value?: string) {
  if (!value) return "";
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export async function GET() {
  try {
    const response = await fetch(NEWS_FEED_URL, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      },
      next: { revalidate: 300 },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "Failed to fetch headlines" },
        { status: 502 },
      );
    }

    const xml = await response.text();
    const parsed = parser.parse(xml);
    const channel = parsed?.rss?.channel;
    const items: RssItem[] = Array.isArray(channel?.item)
      ? channel.item
      : channel?.item
        ? [channel.item]
        : [];

    const headlines = items.slice(0, 6).map((item) => ({
      title: sanitizeText(item.title) || "अज्ञात शीर्षक",
      link: item.link ?? "",
      publishedAt: item.pubDate ?? "",
      description: sanitizeText(item.description),
    }));

    return NextResponse.json({ headlines });
  } catch (error) {
    console.error("headlines route error", error);
    return NextResponse.json(
      { error: "Unexpected error while fetching headlines" },
      { status: 500 },
    );
  }
}
