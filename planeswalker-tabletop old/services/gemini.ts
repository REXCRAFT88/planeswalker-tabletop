import { GoogleGenAI } from "@google/genai";

let ai: GoogleGenAI | null = null;

if (process.env.API_KEY) {
  ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
}

export const askJudge = async (question: string, context?: string): Promise<string> => {
  if (!ai) return "Error: API Key not configured. Please check environment settings.";

  try {
    const model = 'gemini-3-flash-preview';
    const systemInstruction = `You are a certified Level 3 Magic: The Gathering Judge. 
    Answer the user's rules question concisely and accurately. 
    Cite specific rules from the Comprehensive Rules (CR) or Oracle rulings when possible.
    If the question is about a specific card interaction, explain the stack interaction clearly.
    Keep the tone professional, helpful, and neutral.
    ${context ? `Context about the game state: ${context}` : ''}
    `;

    const response = await ai.models.generateContent({
      model: model,
      contents: question,
      config: {
        systemInstruction: systemInstruction,
      },
    });

    return response.text || "The Judge is currently unavailable (No response).";
  } catch (error) {
    console.error("Gemini Judge Error:", error);
    return "The Judge encountered an error consulting the rules.";
  }
};
