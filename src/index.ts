import Anthropic from "@anthropic-ai/sdk";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!ANTHROPIC_API_KEY || !TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
  console.error(
    "Missing required environment variables: ANTHROPIC_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID"
  );
  process.exit(1);
}

const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `Sen bir blockchain geliştirici haber asistanısın. Görevin, güncel blockchain geliştirici haberlerini Türkçe olarak özetlemek.

Haber kategorileri (SADECE bunlara odaklan):
- Yeni EIP'ler (Ethereum Improvement Proposals) ve diğer protokol geliştirme önerileri
- Protokol güncellemeleri ve hard fork'lar
- Geliştirici araçları, SDK'lar, framework güncellemeleri
- AI + kripto / Web3 kesişim noktaları
- L2 geliştirmeleri (Optimism, Arbitrum, zkSync, Starknet, vb.)
- Akıllı kontrat güvenlik açıkları ve audit'ler
- Yeni standartlar, ERC'ler, protokol entegrasyonları

KESİNLİKLE DIŞLA:
- Fiyat haberleri, piyasa analizleri
- Token lansmanları, ICO/IDO duyuruları
- Yatırım ve spekülatif içerik

Çıktı formatı:
Her haber maddesi tam olarak şu iki satırlık HTML formatında olmalı (aralarında boş satır olmasın):
<b>Başlık</b> — özet (max 2 cümle).
CLAUDE_TOPIC:ANA_KONU|KAYNAK_URL

Burada:
- ANA_KONU: haberin ana konusu/protokolü/EIP adı (örn: "EIP-7702", "Arbitrum Orbit", "zkSync Era"). Kısa ve öz olsun, | karakteri içermesin.
- KAYNAK_URL: haberin tam kaynak URL'si

Kurallar:
- 5-8 haber maddesi listele
- Her madde için gerçek, doğrulanabilir kaynak URL'si kullan
- Başlık Türkçe, açıklama Türkçe
- HTML tag'lerini asla kırma veya iç içe geçirme
- Her madde çift satır (başlık satırı + CLAUDE_TOPIC satırı), maddeler arasında bir boş satır bırak
- Liste başına tarih ekle: <b>📅 [TARİH] Blockchain Geliştirici Haberleri</b>
- Liste sonuna şu notu ekle: <i>🤖 Bu özet Anthropic Claude tarafından web araması kullanılarak oluşturulmuştur.</i>`;

const USER_PROMPT = `Bugünün tarihini kullanarak (${new Date().toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" })}), son 24-48 saatteki en önemli blockchain geliştirici haberlerini web'de ara ve Türkçe özet oluştur.

Arama yaparken şu konuları araştır:
1. "ethereum EIP proposal 2025" veya "ethereum improvement proposal latest"
2. "blockchain developer tools update 2025"
3. "L2 layer2 ethereum update rollup 2025"
4. "AI crypto blockchain developer 2025"
5. "smart contract security vulnerability 2025"
6. "web3 protocol update developer 2025"

Sadece geliştirici odaklı, teknik içerikli haberleri seç. Fiyat ve piyasa haberlerini kesinlikle dahil etme.`;

function buildClaudeUrl(topic: string): string {
  const query = `${topic} hakkında detaylı teknik açıklama`;
  return `https://claude.ai/new?q=${encodeURIComponent(query)}`;
}

function processNewsLinks(raw: string): string {
  // Replace each CLAUDE_TOPIC:TOPIC|SOURCE_URL line with the two formatted links
  return raw.replace(
    /^CLAUDE_TOPIC:([^|]+)\|(.+)$/gm,
    (_, topic, sourceUrl) => {
      const claudeUrl = buildClaudeUrl(topic.trim());
      return `<a href="${sourceUrl.trim()}">📖 Kaynağı oku</a>  <a href="${claudeUrl}">🤖 Claude'a sor</a>`;
    }
  );
}

interface TelegramResponse {
  ok: boolean;
  description?: string;
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

  const { chat, message_id } = (result as any).result;
  console.log(
    `Message sent. message_id=${message_id} chat_id=${chat.id} chat_type=${chat.type} title=${chat.title ?? chat.username ?? chat.first_name}`
  );
}

async function fetchBlockchainNews(): Promise<string> {
  console.log("Fetching blockchain developer news via Anthropic API...");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response = await (client.messages.create as any)({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    tools: [{ type: "web_search_20250305", name: "web_search" }],
    messages: [{ role: "user", content: USER_PROMPT }],
  });

  // Extract the final text content from the response
  let newsText = "";
  for (const block of response.content) {
    if (block.type === "text") {
      newsText = block.text;
    }
  }

  if (!newsText) {
    throw new Error("No text content received from Anthropic API");
  }

  console.log("--- RAW MODEL OUTPUT ---");
  console.log(newsText);
  console.log("--- END RAW OUTPUT ---");

  return processNewsLinks(newsText);
}

async function main(): Promise<void> {
  try {
    console.log(`Starting blockchain news bot at ${new Date().toISOString()}`);

    const newsContent = await fetchBlockchainNews();
    console.log("News fetched successfully. Sending to Telegram...");

    // Telegram has a 4096 character limit per message
    if (newsContent.length > 4096) {
      // Split into chunks at newline boundaries
      const lines = newsContent.split("\n");
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
      await sendTelegramMessage(newsContent);
    }

    console.log("Done.");
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

main();
