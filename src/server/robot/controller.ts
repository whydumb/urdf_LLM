export interface RobotMotion {
  joint: string;
  angle: number;
  time?: number;
  speed?: number;
}

export interface RobotController {
  moveJoints(motions: RobotMotion[]): Promise<void>;
  ping(): Promise<boolean>;
}

interface ControllerOptions {
  debug?: boolean;
}

class MockRobotController implements RobotController {
  #debug: boolean;

  constructor(options: ControllerOptions = {}) {
    this.#debug = Boolean(options.debug);
  }

  async moveJoints(motions: RobotMotion[]): Promise<void> {
    if (this.#debug) {
      console.info("[MockRobotController] Executing motions", motions);
    }
  }

  async ping(): Promise<boolean> {
    if (this.#debug) {
      console.info("[MockRobotController] ping");
    }
    return true;
  }
}

let controller: RobotController | null = null;

export function createRobotController(options: ControllerOptions = {}): RobotController {
  controller = new MockRobotController(options);
  return controller;
}

export function setRobotController(custom: RobotController): void {
  controller = custom;
}

export function getRobotController(): RobotController {
  if (!controller) {
    controller = new MockRobotController({ debug: process.env.NODE_ENV !== "production" });
  }
  return controller;
}
