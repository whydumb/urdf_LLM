import { GPT, type GPTOptions } from "./openai";
import { stringifyTurns, type ChatTurn } from "./utils";

export interface PrompterOptions extends GPTOptions {
  /**
   * Friendly label for the agent; used only for logging.
   */
  name?: string;
  /**
   * Optional override for the system message. If omitted, we fall back to a
   * Mechaverse-focused helper persona.
   */
  systemMessage?: string;
}

const DEFAULT_SYSTEM_MESSAGE = `You are Mechaverse Copilot, a helpful assistant embedded in a robotics
viewer. Provide concise, actionable answers in Korean when the user writes in
Korean. If the question is about 3D robot models or Mechaverse features, give
step-by-step guidance. When unsure, be honest and suggest what additional
information is required.`;

export class Prompter {
  private readonly chatModel: GPT;
  private readonly name: string;
  private systemMessage: string;

  constructor(options: PrompterOptions = {}) {
    const { systemMessage, name = "Mechaverse Copilot", ...gptOptions } = options;
    this.chatModel = new GPT(gptOptions.modelName, gptOptions.baseUrl, gptOptions.params);
    this.systemMessage = systemMessage ?? DEFAULT_SYSTEM_MESSAGE;
    this.name = name;
  }

  setSystemMessage(message: string) {
    this.systemMessage = message;
  }

  getSystemMessage() {
    return this.systemMessage;
  }

  async prompt(turns: ChatTurn[]): Promise<string> {
    const generation = await this.chatModel.sendRequest(turns, this.systemMessage);
    if (process.env.NODE_ENV !== "production") {
      console.info(`[Prompter:${this.name}]`, stringifyTurns(turns));
      console.info(`[Prompter:${this.name}] => ${generation}`);
    }
    return generation;
  }
}
