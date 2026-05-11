import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export async function extractResumeData(input: { base64Data?: string, mimeType?: string, textContent?: string }) {
  const model = "gemini-3-flash-preview";
  
  const prompt = `
    Extract structured information from this resume. 

    ========================
    STEP 1: EXTRACT PRIMARY JOB ROLE / RESUME TITLE
    ========================
    - Identify exactly ONE primary job role or professional title for the candidate.
    - If the resume has a clear title at the top (e.g., "Full Stack Developer", "Power BI Developer", "AI Engineer"), use that.
    - Otherwise, use the most recent job title or the most relevant role based on projects/experience.
    - Output must be short (2–4 words max).
    - Example: "QA Automation Engineer" -> "QA Automation Testing".
    - Example: "AI/ML Engineer" -> "AI Engineer".
    - Example: "Power BI Dev" -> "Power BI Developer".

    ========================
    STEP 2: NORMALIZE ROLE
    ========================
    Normalize similar roles into standard names for consistent folder grouping:
    - QA Automation Engineer / Test Engineer (Automation) / SDET -> QA Automation Testing
    - Manual Tester / QA Tester / Software Quality Analyst -> Manual Testing
    - Frontend Engineer / React Developer / UI Developer / Frontend React Developer -> Frontend Developer
    - Backend Engineer / Node.js Developer / Java Developer -> Backend Developer
    - Full Stack Engineer / Web Developer -> Full Stack Developer
    - Data Analyst / Business Intelligence / Power BI Developer -> Data Analyst
    - Data Scientist / Machine Learning Engineer / AI Engineer -> AI/Data Science
    - DevOps Engineer / SRE -> DevOps Engineer
    - Project Manager / Product Manager -> Product/Project Manager
    - UI/UX Designer / Product Designer -> UI/UX Designer
    - HR Manager / Recruiter -> Human Resources

    Return the data in the following JSON format:
    {
      "fullName": "string",
      "email": "string",
      "phone": "string",
      "primaryRole": "string (The normalized job role from Step 2)",
      "skills": ["string"],
      "workExperience": "string (markdown formatted)",
      "education": "string (markdown formatted)",
      "projects": "string (markdown formatted)",
      "location": "string"
    }
    
    Guidelines:
    - DO NOT use technical skills (like Java, React) as the primaryRole unless strictly part of a title.
    - Normalize skills (e.g., "React.js" -> "React").
    - If a field is not found, use an empty string or empty array.
    - Be accurate and concise.
  `;

  const parts: any[] = [{ text: prompt }];
  
  if (input.textContent) {
    parts.push({ text: `Resume Content:\n${input.textContent}` });
  } else if (input.base64Data && input.mimeType) {
    parts.push({
      inlineData: {
        data: input.base64Data,
        mimeType: input.mimeType
      }
    });
  }

  const response = await ai.models.generateContent({
    model,
    contents: [{ parts }],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          fullName: { type: Type.STRING },
          email: { type: Type.STRING },
          phone: { type: Type.STRING },
          primaryRole: { type: Type.STRING },
          skills: { type: Type.ARRAY, items: { type: Type.STRING } },
          workExperience: { type: Type.STRING },
          education: { type: Type.STRING },
          projects: { type: Type.STRING },
          location: { type: Type.STRING }
        },
        required: ["fullName", "email", "primaryRole", "skills"]
      }
    }
  });

  return JSON.parse(response.text || "{}");
}
