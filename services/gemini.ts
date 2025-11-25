import { GoogleGenAI } from "@google/genai";
import { Message } from "../types";

const SYSTEM_INSTRUCTION = `You are Nexus AI, a helpful and witty assistant inside a group chat. 
Your goal is to help users, answer questions, and sometimes make jokes. 
Keep your responses relatively concise (under 150 words) unless asked for a detailed explanation. 
You can see the recent chat history to understand context.
Format your response in Markdown.`;

let aiClient: GoogleGenAI | null = null;

const getClient = () => {
  if (!aiClient) {
    // Determine API Key presence securely
    const apiKey = process.env.API_KEY;
    if (apiKey) {
      aiClient = new GoogleGenAI({ apiKey });
    } else {
      console.warn("Gemini API Key is missing. AI features will be disabled.");
    }
  }
  return aiClient;
};

export const generateAIResponse = async (
  currentMessage: string,
  history: Message[]
): Promise<string> => {
  const client = getClient();
  if (!client) return "⚠️ AI System Error: API Key not configured.";

  try {
    // Convert last few messages to a simple text context
    const recentContext = history
      .slice(-10) // Take last 10 messages for context
      .map(m => `${m.senderName}: ${m.type === 'IMAGE' ? '[Image]' : m.content}`)
      .join('\n');

    const prompt = `
Context of the chat so far:
${recentContext}

Current User Message: ${currentMessage}

Please respond to the Current User Message.`;

    const response = await client.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
      },
    });

    return response.text || "I'm thinking... but couldn't come up with words.";
  } catch (error) {
    console.error("Gemini API Error:", error);
    return "⚠️ Sorry, I'm having trouble connecting to my brain right now.";
  }
};