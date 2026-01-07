import { createRobotController, type RobotController, type RobotMotion } from "../../robot/controller";

export interface DynamicActionPayload {
  name?: string;
  reasoning?: string;
  motions: RobotMotion[];
}

export class PluginInstance {
  private readonly robotController: RobotController;

  constructor(private readonly agent?: { name?: string }) {
    this.robotController = createRobotController({ debug: process.env.NODE_ENV !== "production" });
  }

  async init() {
    try {
      const online = await this.robotController.ping();
      console.log(`🤖 Robot ${online ? "connected" : "offline"}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.warn("🤖 Robot controller init warning:", message);
    }
  }

  async performDynamicAction(payload: DynamicActionPayload) {
    if (!payload?.motions || payload.motions.length === 0) {
      throw new Error("performDynamicAction requires at least one motion");
    }

    await this.robotController.moveJoints(payload.motions);
  }

  getPluginActions() {
    return [];
  }
}
