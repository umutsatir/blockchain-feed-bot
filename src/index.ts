import Anthropic from "@anthropic-ai/sdk";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const MODEL = process.env.MODEL || "claude-haiku-4-5-20251001";
const RUN_EVERY_DAYS = parseInt(process.env.RUN_EVERY_DAYS || "1", 10);

if (!ANTHROPIC_API_KEY || !TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
  console.error(
    "Missing required env vars: ANTHROPIC_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID"
  );
  process.exit(1);
}

const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

interface NewsItem {
  title: string;
  summary: string;
  url: string;
  topic: string;
}

const SYSTEM_PROMPT = `Sen bir blockchain geliştirici haber asistanısın.

Görevin: Son 24-48 saatteki önemli blockchain geliştirici haberlerini web'de arayıp bulmak ve JSON formatında döndürmek.

Haber kategorileri (SADECE bunlara odaklan):
- Yeni EIP'ler ve protokol geliştirme önerileri
- Protokol güncellemeleri ve hard fork'lar
- Geliştirici araçları, SDK'lar, framework güncellemeleri
- AI + kripto / Web3 kesişim noktaları
- L2 geliştirmeleri (Optimism, Arbitrum, zkSync, Starknet vb.)
- Akıllı kontrat güvenlik açıkları ve audit'ler
- Yeni standartlar, ERC'ler, protokol entegrasyonları

KESİNLİKLE DIŞLA: fiyat haberleri, piyasa analizi, token lansmanı, ICO/IDO, yatırım içeriği.

ÇIKTI: Sadece ve sadece geçerli bir JSON dizisi döndür. Markdown yok, açıklama yok, kod bloğu yok.

Format:
[
  {
    "title": "Türkçe başlık",
    "summary": "Türkçe özet, maksimum 2 cümle.",
    "url": "https://gercek-kaynak-url.com/makale",
    "topic": "Ana konu adı (örn: EIP-7702, zkSync, Solidity 0.8.25)"
  }
]

Kurallar:
- 5-8 madde döndür
- Her madde için gerçek, çalışır kaynak URL'si kullan
- topic kısa ve öz olsun (genellikle protokol adı veya EIP numarası)`;

const USER_PROMPT = `Bugünün tarihi: ${new Date().toLocaleDateString("tr-TR", {
  day: "numeric",
  month: "long",
  year: "numeric",
})}

Son ${RUN_EVERY_DAYS} günün blockchain geliştirici haberlerini ara. Şu konularda arama yap:
- ethereum EIP improvement proposal latest 2026
- L2 layer2 rollup developer update 2026
- blockchain developer tools SDK update 2026
- AI crypto web3 developer 2026
- smart contract security audit vulnerability 2026

${RUN_EVERY_DAYS > 1 ? `${RUN_EVERY_DAYS} günlük periyodu kapsayan en önemli gelişmeleri derle, tekrar eden haberleri birleştir.` : ""}
Sadece teknik, geliştirici odaklı haberleri seç. JSON dizisini döndür.`;

function buildClaudeUrl(topic: string): string {
  const query = `${topic} hakkında detaylı teknik açıklama`;
  return `https://claude.ai/new?q=${encodeURIComponent(query)}`;
}

function buildTelegramMessage(items: NewsItem[]): string {
  const date = new Date().toLocaleDateString("tr-TR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const lines: string[] = [
    `<b>📅 ${date} Blockchain Geliştirici Haberleri</b>`,
    "",
  ];

  for (const item of items) {
    lines.push(`<b>${item.title}</b> — ${item.summary}`);
    lines.push(
      `<a href="${item.url}">📖 Kaynağı oku</a>  <a href="${buildClaudeUrl(item.topic)}">🤖 Claude'a sor</a>`
    );
    lines.push("");
  }

  lines.push(
    `<i>🤖 Bu özet Anthropic Claude (${MODEL}) tarafından web araması kullanılarak oluşturulmuştur.</i>`
  );

  return lines.join("\n");
}

interface TelegramResponse {
  ok: boolean;
  description?: string;
  result?: { message_id: number; chat: { id: number; type: string; title?: string; username?: string; first_name?: string } };
}

async function sendTelegramMessage(text: string): Promise<void> {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });

  const result = (await response.json()) as TelegramResponse;

  if (!result.ok) {
    throw new Error(`Telegram API error: ${result.description}`);
  }

  const { chat, message_id } = result.result!;
  console.log(
    `Message sent. message_id=${message_id} chat_id=${chat.id} chat_type=${chat.type} title=${chat.title ?? chat.username ?? chat.first_name}`
  );
}

async function fetchBlockchainNews(): Promise<NewsItem[]> {
  console.log(`Fetching news with model: ${MODEL}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response = await (client.messages.create as any)({
    model: MODEL,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    tools: [{ type: "web_search_20250305", name: "web_search" }],
    messages: [{ role: "user", content: USER_PROMPT }],
  });

  let rawText = "";
  for (const block of response.content) {
    if (block.type === "text") {
      rawText = block.text;
    }
  }

  if (!rawText) {
    throw new Error("No text content received from Anthropic API");
  }

  console.log("--- RAW MODEL OUTPUT ---");
  console.log(rawText);
  console.log("--- END RAW OUTPUT ---");

  // Strip markdown code fences if model wrapped the JSON
  const cleaned = rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

  let items: NewsItem[];
  try {
    items = JSON.parse(cleaned);
  } catch {
    throw new Error(`Failed to parse model output as JSON: ${cleaned.slice(0, 200)}`);
  }

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Model returned empty or non-array JSON");
  }

  return items;
}

async function main(): Promise<void> {
  try {
    console.log(`Starting blockchain news bot at ${new Date().toISOString()}`);

    const items = await fetchBlockchainNews();
    console.log(`Fetched ${items.length} news items. Sending to Telegram...`);

    const message = buildTelegramMessage(items);

    // Telegram 4096 char limit — split at newline boundaries if needed
    if (message.length > 4096) {
      const lines = message.split("\n");
      let chunk = "";
      for (const line of lines) {
        if ((chunk + "\n" + line).length > 4096) {
          if (chunk) await sendTelegramMessage(chunk.trim());
          chunk = line;
        } else {
          chunk = chunk ? chunk + "\n" + line : line;
        }
      }
      if (chunk.trim()) await sendTelegramMessage(chunk.trim());
    } else {
      await sendTelegramMessage(message);
    }

    console.log("Done.");
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

main();
