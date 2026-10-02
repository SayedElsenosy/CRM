type State =
  | 'WAITING_AGE'
  | 'WAITING_AREA'
  | 'WAITING_MOTORCYCLE'
  | 'WAITING_LICENSE'
  | 'WAITING_SHIFT';

export type AiExtraction = {
  understood: boolean;
  age?: number | null;
  area?: string | null;
  yes_no?: boolean | null;
};

/**
 * Optional fallback only. We intentionally send ONLY the current state and the
 * applicant's current text. Do not send phone numbers, document images, IDs,
 * or the full applicant profile to the model.
 */
export async function extractWithGemini(state: State, userText: string, areas: readonly string[] = []): Promise<AiExtraction | null> {
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) return null;
  const model = Deno.env.get('GEMINI_MODEL') || 'gemini-2.5-flash-lite';

  const allowedAreas = areas.join('، ');
  const prompt = `
أنت parser فقط لنظام توظيف طياري دليفري في مصر.
لا تتخذ قرار قبول أو رفض. استخرج فقط الإجابة الحالية.
الحالة الحالية: ${state}
رسالة المتقدم: ${userText}

قواعد:
- WAITING_AGE: استخرج age رقم صحيح إن كان واضحًا.
- WAITING_AREA: area يجب أن تكون واحدة فقط من: ${allowedAreas}. لو المتقدم يقصد منطقة أخرى، اجعل area=null.
- WAITING_MOTORCYCLE / WAITING_LICENSE / WAITING_SHIFT: استخرج yes_no=true/false فقط لو المعنى واضح.
- understood=false لو الإجابة غامضة.
`;

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            understood: { type: 'BOOLEAN' },
            age: { type: 'INTEGER' },
            area: { type: 'STRING' },
            yes_no: { type: 'BOOLEAN' },
          },
          required: ['understood'],
        },
      },
    }),
  });

  if (!response.ok) {
    console.error('Gemini error', response.status, await response.text());
    return null;
  }
  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) return null;
  try {
    return JSON.parse(text) as AiExtraction;
  } catch {
    return null;
  }
}
