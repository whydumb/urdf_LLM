export function buildVisionEvalPrompt(
  jointState: string,
  iteration: number,
  task: string,
): string {
  return `You are a robot locomotion evaluator watching a MuJoCo physics simulation.

TASK: ${task}

Look at the screenshot and the joint state, then evaluate:

1. POSTURE: Is the robot standing upright, leaning, or fallen on the ground?
2. MOVEMENT: Is it walking, twitching, stuck, or making progress?
3. QUALITY: Rate the motion quality 0-10 (0=collapsed, 5=standing but not moving, 10=smooth walking)

Current joint state: ${jointState}
Iteration: ${iteration}

Respond in ONLY valid JSON:
{
  "posture": "standing" | "leaning" | "fallen" | "crawling",
  "movement": "walking" | "twitching" | "stuck" | "falling" | "recovering",
  "quality": <number 0-10>,
  "fallen": <boolean>,
  "suggestion": "<one-line advice for next motion, in English>"
}`;
}

export function buildVisionMotorPrompt(
  jointState: string,
  visionEval: { posture: string; movement: string; quality: number; fallen: boolean; suggestion: string },
  iteration: number,
  failureHistory: string[],
): string {
  const historyBlock = failureHistory.length > 0
    ? `\nRecent history:\n${failureHistory.slice(-5).join("\n")}`
    : "";

  return `You are a MuJoCo bipedal robot motor controller.

VISION EVALUATION:
- Posture: ${visionEval.posture}
- Movement: ${visionEval.movement}
- Quality: ${visionEval.quality}/10
- Fallen: ${visionEval.fallen}
- Suggestion: ${visionEval.suggestion}

Current joints: ${jointState}
Iteration: ${iteration}
${historyBlock}

${visionEval.fallen
    ? "PRIORITY: Robot has fallen. Generate a recovery motion first (curl up, push up, stand)."
    : visionEval.quality < 3
      ? "PRIORITY: Very poor motion. Try smaller, more conservative movements."
      : "Continue improving the walking gait."
}

AVAILABLE JOINTS (exact names, radians):
l_hip_pitch[-1.2,0.8] l_hip_roll[-0.3,0.3] l_hip_yaw[-0.2,0.2] l_knee[0,1.5]
l_ank_pitch[-0.8,0.8] l_ank_roll[-0.3,0.3]
r_hip_pitch[-1.2,0.8] r_hip_roll[-0.3,0.3] r_hip_yaw[-0.2,0.2] r_knee[0,1.5]
r_ank_pitch[-0.8,0.8] r_ank_roll[-0.3,0.3]
l_sho_pitch[-1.5,1.5] l_sho_roll[-0.5,1.5] l_el[-2.0,0]
r_sho_pitch[-1.5,1.5] r_sho_roll[-1.5,0.5] r_el[0,2.0]
head_pan[-0.8,0.8] head_tilt[-0.5,0.5]

Rules: l_knee,r_knee>=0 | l_el<=0,r_el>=0 | anti-phase legs | time in ms

Output ONLY valid JSON:
{"motions":[{"joint":"...","angle":0.0,"time":0},...]}"`;
}