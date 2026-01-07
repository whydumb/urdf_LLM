import { getRobotController, type RobotMotion } from "../robot/controller";

function isValidMotion(motion: Partial<RobotMotion>): motion is RobotMotion {
  if (!motion) return false;
  if (typeof motion.joint !== "string" || motion.joint.trim().length === 0) return false;
  if (typeof motion.angle !== "number" || Number.isNaN(motion.angle)) return false;
  if (motion.time !== undefined && (typeof motion.time !== "number" || motion.time < 0)) return false;
  if (motion.speed !== undefined && (typeof motion.speed !== "number" || motion.speed <= 0)) return false;
  return true;
}

export async function runDynamicAction(motions: Partial<RobotMotion>[]) {
  const validated = motions.filter(isValidMotion);

  if (validated.length === 0) {
    throw new Error("No valid robot motions provided");
  }

  const controller = getRobotController();
  await controller.moveJoints(validated);
}
