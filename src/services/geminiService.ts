import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export const analyzeItemImage = async (base64Image: string) => {
  if (!base64Image) {
    throw new Error("No image data provided");
  }

  const model = "gemini-3-flash-preview";
  
  // Robust base64 extraction
  const mimeTypeMatch = base64Image.match(/^data:(image\/[a-z]+);base64,/);
  const mimeType = mimeTypeMatch ? mimeTypeMatch[1] : "image/jpeg";
  const base64Data = base64Image.includes(",") ? base64Image.split(",")[1] : base64Image;
  
  // Clean base64 data (remove whitespace/newlines)
  const cleanBase64Data = base64Data.replace(/\s/g, '');

  const prompt = `Analyze this photo of a resale item. 
  Identify the Brand, Item Type (Shoes, Clothing, or Accessory), and Condition (New, Like New, or Used).
  Also, suggest a catchy marketplace title and a short, professional description.
  Estimate a realistic average resale price based on common market values for this type of item.
  Determine the sell-through rate (High, Medium, or Low).`;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: mimeType,
                data: cleanBase64Data,
              },
            },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            brand: { type: Type.STRING },
            type: { type: Type.STRING, enum: ["Shoes", "Clothing", "Accessory"] },
            condition: { type: Type.STRING, enum: ["New", "Like New", "Used"] },
            suggestedTitle: { type: Type.STRING },
            suggestedDescription: { type: Type.STRING },
            estimatedResalePrice: { type: Type.NUMBER },
            sellThroughRate: { type: Type.STRING, enum: ["High", "Medium", "Low"] },
            itemName: { type: Type.STRING }
          },
          required: ["brand", "type", "condition", "suggestedTitle", "suggestedDescription", "estimatedResalePrice", "sellThroughRate", "itemName"]
        }
      }
    });

    if (!response.text) {
      throw new Error("Empty response from AI");
    }

    return JSON.parse(response.text);
  } catch (error) {
    console.error("Gemini Analysis Error:", error);
    throw error;
  }
};
