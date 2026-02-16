// src/utils/llmMotionPrompt.ts
// Motor LLM 프롬프트 빌더

import {
  MUJOCO_JOINT_ORDER,
  JOINT_CONSTRAINTS,
} from "@/constants/jointConfig";

export function buildMotorPrompt(
  task: string,
  failureHistory: string[],
  currentPose?: Record<string, number> | null,
): string {
  const jointSpec = MUJOCO_JOINT_ORDER
    .map((name) => {
      const c = JOINT_CONSTRAINTS[name];
      const cur = currentPose?.[name];
      const curStr = cur !== undefined ? ` current=${cur.toFixed(3)}` : "";
      return `  ${name}: [${c.min}, ${c.max}]${curStr}${c.note ? ` // ${c.note}` : ""}`;
    })
    .join("\n");

  const historyBlock =
    failureHistory.length > 0
      ? `\nPREVIOUS ATTEMPTS (learn from these failures — avoid repeating them):\n${failureHistory
          .slice(-5)
          .join("\n")}\n`
      : "";

  return `You are a bipedal humanoid robot motion designer.
Generate a walking cycle as keyframe data at 30fps.

ROBOT: 20 DOF humanoid controlled by PD controller (kp=200, kd=20).
Simulation runs at 60Hz. The keyframes you output are interpolated smoothly.

JOINTS (name: [min_rad, max_rad]):
${jointSpec}

CRITICAL PHYSICS RULES:
1. Opposite legs ANTI-PHASE: when l_hip_pitch < 0 (forward), r_hip_pitch > 0 (back), and vice versa.
2. Arms swing opposite to SAME-SIDE leg: l_sho_pitch anti-phase with l_hip_pitch.
3. Knees MUST be >= 0 at ALL times (cannot bend backwards).
4. l_el MUST be <= 0, r_el MUST be >= 0 (elbow direction constraint).
5. Keep hip_roll, hip_yaw, ank_roll SMALL (< 0.15 rad) for stability.
6. Smooth transitions: max ±0.3 rad change between adjacent keyframes.
7. Start and end pose should be similar (for looping).
8. One full gait cycle = 30-60 frames (1-2 seconds at 30fps).
9. During stance phase, knee should be slightly bent (0.1-0.3 rad) for stability.
10. Ankle pitch should compensate for hip pitch to keep foot flat on ground.
${historyBlock}
TASK: ${task}

OUTPUT FORMAT — Return ONLY a valid JSON array. No markdown, no explanation, no code fences:
[
  {"frame":0,"pose":{"l_hip_pitch":0,"l_hip_roll":0,"l_hip_yaw":0,"l_knee":0.2,"l_ank_pitch":0,"l_ank_roll":0,"r_hip_pitch":0,"r_hip_roll":0,"r_hip_yaw":0,"r_knee":0.2,"r_ank_pitch":0,"r_ank_roll":0,"l_sho_pitch":0,"l_sho_roll":0.52,"l_el":-0.3,"r_sho_pitch":0,"r_sho_roll":-0.52,"r_el":0.3,"head_pan":0,"head_tilt":0}},
  {"frame":5,"pose":{...}},
  ...
]

Every keyframe MUST include ALL 20 joints. Frames start at 0.`;
}

export function buildIntentPrompt(userMessage: string): string {
  return `Classify the user's intent for a humanoid robot controller.

Categories:
- "walk": user wants the robot to walk, move forward, take steps
- "stand": user wants the robot to stand still, balance, stop
- "pose": user wants a specific pose (wave, bow, raise arm, etc.)
- "reset": user wants to reset the robot
- "chat": general conversation, question about the robot

User message: "${userMessage}"

Respond with ONLY one word from: walk, stand, pose, reset, chat`;
}

export function buildPosePrompt(
  userMessage: string,
  currentPose?: Record<string, number> | null,
): string {
  const jointSpec = MUJOCO_JOINT_ORDER
    .map((name) => {
      const c = JOINT_CONSTRAINTS[name];
      const cur = currentPose?.[name];
      const curStr = cur !== undefined ? ` current=${cur.toFixed(3)}` : "";
      return `  ${name}: [${c.min}, ${c.max}]${curStr}`;
    })
    .join("\n");

  return `You are a humanoid robot pose designer.
The user wants a specific pose. Generate a SINGLE keyframe.

JOINTS (name: [min_rad, max_rad]):
${jointSpec}

CONSTRAINTS:
- l_knee, r_knee >= 0
- l_el <= 0, r_el >= 0
- Values in radians

User request: "${userMessage}"

OUTPUT: ONLY a valid JSON object (not array), no other text:
{"l_hip_pitch":0,"l_hip_roll":0,...all 20 joints...}`;
}