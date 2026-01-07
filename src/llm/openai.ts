import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

import { strictFormat, type ChatTurn } from "./utils";

const KEYS_PATH = resolve(process.cwd(), "keys.json");

let keys: Record<string, string> = {};
try {
  if (existsSync(KEYS_PATH)) {
    const data = readFileSync(KEYS_PATH, "utf8");
    keys = JSON.parse(data);
  } else {
    console.warn("keys.json not found. Defaulting to environment variables.");
  }
} catch {
  console.warn("Failed to read/parse keys.json. Defaulting to environment variables.");
}

export function getKey(name: string): string {
  const key = keys?.[name] ?? process.env?.[name];
  if (!key) {
    throw new Error(`API key "${name}" not found in keys.json or environment variables!`);
  }
  return key;
}

export function hasKey(name: string): boolean {
  return Boolean(keys?.[name] || process.env?.[name]);
}

function createOpenAIClient(baseURL?: string) {
  const config: OpenAI.ClientOptions = {};

  if (baseURL) config.baseURL = baseURL;
  if (hasKey("OPENAI_ORG_ID")) config.organization = getKey("OPENAI_ORG_ID");

  config.apiKey = getKey("OPENAI_API_KEY");

  return new OpenAI(config);
}

function extractErrorDetails(error: unknown): { message: string; code?: string } {
  if (error instanceof Error) {
    const maybeCode = (error as Error & { code?: unknown }).code;
    return {
      message: error.message,
      code: typeof maybeCode === "string" ? maybeCode : undefined,
    };
  }

  if (typeof error === "object" && error !== null) {
    const messageValue = (error as { message?: unknown }).message;
    const codeValue = (error as { code?: unknown }).code;
    return {
      message: typeof messageValue === "string" ? messageValue : "",
      code: typeof codeValue === "string" ? codeValue : undefined,
    };
  }

  return { message: "" };
}

export interface GPTOptions {
  modelName?: string;
  baseUrl?: string;
  params?: Record<string, unknown>;
}

export class GPT {
  static prefix = "openai" as const;

  private readonly params?: Record<string, unknown>;
  private readonly openai: OpenAI;
  private readonly modelName: string;
  private readonly supportsRawImageInput: boolean;

  private readonly visionModels = [
    "gpt-4o",
    "gpt-4o-mini",
    "gpt-4-turbo",
    "gpt-4.1",
    "gpt-4.1-mini",
    "gpt-4-vision-preview",
  ];

  constructor(modelName?: string, baseUrl?: string, params?: Record<string, unknown>) {
    this.modelName = modelName || "gpt-4o-mini";
    this.params = params;
    this.openai = createOpenAIClient(baseUrl);
    this.supportsRawImageInput = this.visionModels.some((model) =>
      this.modelName.toLowerCase().includes(model.toLowerCase()),
    );
  }

  async sendRequest(
    turns: ChatTurn[] = [],
    systemMessage: string,
    imageData: Buffer | null = null,
    stopSeq = "***",
  ): Promise<string> {
    const formatted = strictFormat(turns);
    const apiMessages: ChatCompletionMessageParam[] = [
      { role: "system", content: systemMessage },
    ];

    formatted.forEach((turn, index) => {
      const isLast = index === formatted.length - 1;

      if (imageData && isLast && this.supportsRawImageInput) {
        const base64Image = imageData.toString("base64");
        apiMessages.push({
          role: turn.role,
          content: [
            { type: "text", text: `${turn.content}${stopSeq}` },
            {
              type: "image_url",
              image_url: { url: `data:image/jpeg;base64,${base64Image}` },
            },
          ],
        });
      } else {
        apiMessages.push({
          role: turn.role,
          content: `${turn.content}${stopSeq}`,
        });
      }
    });

    try {
      const response = await this.openai.chat.completions.create({
        model: this.modelName,
        messages: apiMessages,
        ...(this.params || {}),
      });

      let result = response.choices?.[0]?.message?.content ?? "";
      const index = result.indexOf(stopSeq);
      if (index !== -1) {
        result = result.slice(0, index);
      }
      return result.trim();
    } catch (error: unknown) {
      console.error("[GPT Error]", error);

      const { message: errMessage, code: errCode } = extractErrorDetails(error);

      if (
        (errMessage === "Context length exceeded" || errCode === "context_length_exceeded") &&
        formatted.length > 1
      ) {
        return this.sendRequest(formatted.slice(1), systemMessage, imageData, stopSeq);
      }

      if (errMessage && (errMessage.includes("image_url") || errMessage.includes("vision"))) {
        return "Vision is only supported by certain models.";
      }

      return "My brain disconnected, try again.";
    }
  }

  async sendVisionRequest(turns: ChatTurn[], systemMessage: string, imageBuffer: Buffer) {
    return this.sendRequest(turns, systemMessage, imageBuffer);
  }

  async embed(text: string) {
    const trimmed = text.length > 8191 ? text.slice(0, 8191) : text;

    const embedding = await this.openai.embeddings.create({
      model: this.modelName || "text-embedding-3-small",
      input: trimmed,
      encoding_format: "float",
    });

    return embedding.data[0]?.embedding ?? [];
  }
}

const sendAudioRequest = async (
  text: string,
  model: string,
  voice: string,
  baseUrl?: string,
): Promise<string> => {
  const payload = {
    model,
    voice,
    input: text,
  } as const;

  const openai = createOpenAIClient(baseUrl);

  const mp3 = await openai.audio.speech.create(payload);
  const buffer = Buffer.from(await mp3.arrayBuffer());
  return buffer.toString("base64");
};

export const TTSConfig = {
  sendAudioRequest,
  baseUrl: "https://api.openai.com/v1",
};
