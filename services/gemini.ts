import { Message } from "../types";

const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";
const SYSTEM_INSTRUCTION = `You are Nexus AI, a helpful and witty assistant inside a group chat. 
Your goal is to help users, answer questions, and sometimes make jokes. 
Keep your responses relatively concise (under 150 words) unless asked for a detailed explanation. 
You can see the recent chat history to understand context.
Format your response in Markdown.`;

export const generateAIResponse = async (
  currentMessage: string,
  history: Message[]
): Promise<string> => {
  const apiKey = process.env.DEEPSEEK_API_KEY;

  if (!apiKey) {
    console.warn("DeepSeek API Key is missing.");
    return "⚠️ AI Configuration Error: API Key missing.";
  }

  try {
    // Convert last few messages to context
    const recentContext = history
      .slice(-10)
      .map(m => `${m.senderName}: ${m.type === 'IMAGE' ? '[Image]' : m.content}`)
      .join('\n');

    const prompt = `
Context of the chat so far:
${recentContext}

Current User Message: ${currentMessage}
`;

    const response = await fetch(DEEPSEEK_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: SYSTEM_INSTRUCTION },
          { role: "user", content: prompt }
        ],
        stream: false,
        temperature: 1.3
      })
    });

    if (!response.ok) {
      throw new Error(`DeepSeek API Error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || "I'm thinking... but couldn't come up with words.";

  } catch (error) {
    console.error("AI Service Error:", error);
    return "⚠️ Sorry, I'm having trouble connecting to my brain right now (DeepSeek API Error).";
  }
};