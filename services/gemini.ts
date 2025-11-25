import { Message, MessageType } from "../types";

const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";
// WARNING: Hardcoding API keys in frontend code is insecure. 
// Anyone can view this key. Use with caution or for testing only.
const DEEPSEEK_API_KEY = "sk-0438341f9a094b9798be75f4ceaa37bd";

const SYSTEM_INSTRUCTION = `You are Nexus AI, a helpful and witty assistant inside a group chat. 
Your goal is to help users, answer questions, and sometimes make jokes. 
Keep your responses relatively concise (under 150 words) unless asked for a detailed explanation. 
You are part of the conversation.
Format your response in Markdown.`;

export const generateAIResponse = async (
  currentMessage: string,
  history: Message[]
): Promise<string> => {
  const apiKey = DEEPSEEK_API_KEY;

  if (!apiKey) {
    console.warn("DeepSeek API Key is missing.");
    return "⚠️ AI Configuration Error: API Key missing.";
  }

  try {
    // Transform history into OpenAI compatible format
    // Increased to last 30 messages to provide better short-term memory
    const conversationHistory = history
      .slice(-30)
      .map(m => {
        const role = m.type === MessageType.AI ? "assistant" : "user";
        // If it's a user message, include their name for context
        const content = m.type === MessageType.AI 
          ? m.content 
          : `${m.senderName}: ${m.type === MessageType.IMAGE ? '[Image Shared]' : m.content}`;
        
        return { role, content };
      });

    const messagesPayload = [
      { role: "system", content: SYSTEM_INSTRUCTION },
      ...conversationHistory
    ];

    // Double check: if the very last message in history is NOT the current prompt, we append it.
    // This handles cases where the state might not have updated yet in the calling component.
    const lastMsg = history[history.length - 1];
    if (!lastMsg || lastMsg.content !== currentMessage) {
        messagesPayload.push({ role: "user", content: currentMessage });
    }

    const response = await fetch(DEEPSEEK_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: messagesPayload,
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