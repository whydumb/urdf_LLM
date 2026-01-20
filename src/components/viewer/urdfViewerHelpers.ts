import {
  LoadingManager,
  Object3D,
  PerspectiveCamera,
  Vector3,
  AmbientLight,
  DirectionalLight,
  Scene,
} from "three";
import { loadMeshFile } from "./meshLoaders";
import { JointLimits } from "../../types/robot";

// Define the interface for the URDF viewer element
export interface URDFViewerElement extends HTMLElement {
  setJointValue: (joint: string, value: number) => void;
  loadMeshFunc?: (
    path: string,
    manager: LoadingManager,
    done: (result: Object3D | null, err?: Error) => void
  ) => void;

  // Extended properties for camera fitting
  camera: PerspectiveCamera;
  controls: {
    target: Vector3;
    update: () => void;
  };
  robot: Object3D;
  redraw: () => void;
  up: string;
  scene: Scene;
  // Optional background property supported by the web component used in URDF mode
  background?: string;
  // Optional renderer reference exposed by the web component (used for canvas capture)
  renderer?: {
    domElement: HTMLCanvasElement;
  };
  
  // Joint limits for enforcing constraints
  jointLimits?: JointLimits;
  originalSetJointValue?: (joint: string, value: number) => void;
}

/**
 * Creates and configures a URDF viewer element
 */
export function createUrdfViewer(container: HTMLDivElement): URDFViewerElement {
  // Clear any existing content
  container.innerHTML = "";

  // Create the urdf-viewer element
  const viewer = document.createElement("urdf-viewer") as URDFViewerElement;
  viewer.classList.add("w-full", "h-full");
  container.appendChild(viewer);

  // Set initial viewer properties
  viewer.setAttribute("up", "Z");
  // Hint transparent background for captures
  try {
    // Attribute supported by urdf-manipulator to set bg
    viewer.background = "transparent";
    viewer.setAttribute("background", "transparent");
  } catch {}
  viewer.setAttribute("highlight-color", "#FBE651");
  viewer.setAttribute("auto-redraw", "true");

  // Add ambient light to the scene
  const ambientLight = new AmbientLight(0xd6d6d6, 1);
  viewer.scene.add(ambientLight);

  // Add directional light for better shadows and depth
  const directionalLight = new DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(5, 30, 5);
  directionalLight.castShadow = true;
  viewer.scene.add(directionalLight);

  return viewer;
}

/**
 * Setup mesh loading function for URDF viewer
 */
export function setupMeshLoader(
  viewer: URDFViewerElement,
  urlModifierFunc: ((url: string) => string) | null
): void {
  if ("loadMeshFunc" in viewer) {
    viewer.loadMeshFunc = (
      path: string,
      manager: LoadingManager,
      done: (result: Object3D | null, err?: Error) => void
    ) => {
      // Apply URL modifier if available (for custom uploads)
      const modifiedPath = urlModifierFunc ? urlModifierFunc(path) : path;

      // If loading fails, log the error but continue
      try {
        loadMeshFile(modifiedPath, manager, (result, err) => {
          if (err) {
            console.warn(`Error loading mesh ${modifiedPath}:`, err);
            // Try to continue with other meshes
            done(null);
          } else if (result === null) {
            // Texture files are handled natively by the URDF viewer
            // Don't log warnings for these
            done(null);
          } else {
            done(result);
          }
        });
      } catch (err) {
        console.error(`Exception loading mesh ${modifiedPath}:`, err);
        done(null, err as Error);
      }
    };
  }
}

/**
 * Setup event handlers for joint highlighting
 */
export function setupJointHighlighting(
  viewer: URDFViewerElement,
  setHighlightedJoint: (joint: string | null) => void
): () => void {
  const onJointMouseover = (e: Event) => {
    const customEvent = e as CustomEvent;
    setHighlightedJoint(customEvent.detail);
  };

  const onJointMouseout = () => {
    setHighlightedJoint(null);
  };

  // Add event listeners
  viewer.addEventListener("joint-mouseover", onJointMouseover);
  viewer.addEventListener("joint-mouseout", onJointMouseout);

  // Return cleanup function
  return () => {
    viewer.removeEventListener("joint-mouseover", onJointMouseover);
    viewer.removeEventListener("joint-mouseout", onJointMouseout);
  };
}

/**
 * Setup model loading and error handling
 */
export function setupModelLoading(
  viewer: URDFViewerElement,
  urdfPath: string
): void {
  // Add XML content type hint for blob URLs
  const loadPath =
    urdfPath.startsWith("blob:") && !urdfPath.includes("#.")
      ? urdfPath + "#.urdf" // Add extension hint if it's a blob URL
      : urdfPath;

  // Set the URDF path
  viewer.setAttribute("urdf", loadPath);
}

/**
 * Parse joint limits from URDF XML content
 */
export function parseJointLimits(urdfContent: string): JointLimits {
  const jointLimits: JointLimits = {};
  
  try {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(urdfContent, "text/xml");
    
    // Find all joint elements
    const joints = xmlDoc.querySelectorAll("joint");
    
    joints.forEach((joint) => {
      const jointName = joint.getAttribute("name");
      const limitElement = joint.querySelector("limit");
      
      if (jointName && limitElement) {
        const lower = limitElement.getAttribute("lower");
        const upper = limitElement.getAttribute("upper");
        const effort = limitElement.getAttribute("effort");
        const velocity = limitElement.getAttribute("velocity");
        
        if (lower !== null && upper !== null) {
          jointLimits[jointName] = {
            lower: parseFloat(lower),
            upper: parseFloat(upper),
            effort: effort ? parseFloat(effort) : undefined,
            velocity: velocity ? parseFloat(velocity) : undefined,
          };
        }
      }
    });
  } catch (error) {
    console.warn("Failed to parse joint limits from URDF:", error);
  }
  
  return jointLimits;
}

/**
 * Clamp a joint value within its specified limits
 */
export function clampJointValue(
  jointName: string,
  value: number,
  jointLimits: JointLimits
): number {
  const limits = jointLimits[jointName];
  if (!limits) {
    return value; // No limits defined, return original value
  }
  
  return Math.max(limits.lower, Math.min(limits.upper, value));
}

/**
 * Setup joint limit enforcement for the URDF viewer
 */
export function setupJointLimits(
  viewer: URDFViewerElement,
  urdfPath: string
): Promise<void> {
  return new Promise((resolve) => {
    // Function to fetch and parse URDF content
    const loadAndParseUrdf = async () => {
      try {
        const response = await fetch(urdfPath);
        const urdfContent = await response.text();
        
        // Parse joint limits from URDF content
        const jointLimits = parseJointLimits(urdfContent);
        viewer.jointLimits = jointLimits;
        
        // Store the original setJointValue function
        if (!viewer.originalSetJointValue) {
          viewer.originalSetJointValue = viewer.setJointValue.bind(viewer);
        }
        
        // Override setJointValue to enforce limits
        viewer.setJointValue = (joint: string, value: number) => {
          const clampedValue = clampJointValue(joint, value, jointLimits);
          
          // Only log if the value was clamped
          if (Math.abs(clampedValue - value) > 1e-6) {
            console.debug(
              `Joint "${joint}" clamped from ${value.toFixed(3)} to ${clampedValue.toFixed(3)} (limits: ${jointLimits[joint]?.lower.toFixed(3)} to ${jointLimits[joint]?.upper.toFixed(3)})`
            );
          }
          
          if (viewer.originalSetJointValue) {
            viewer.originalSetJointValue(joint, clampedValue);
          }
        };
        
        console.log(`Loaded joint limits for ${Object.keys(jointLimits).length} joints`);
        resolve();
      } catch (error) {
        console.warn("Failed to load URDF for joint limits:", error);
        resolve(); // Continue even if joint limits loading fails
      }
    };
    
    loadAndParseUrdf();
  });
}

// ============================================================================
// Joint Motion Functions
// ============================================================================

export type ViewerJointMotion = {
  joint: string;
  angle: number;
  time?: number;
  speed?: number;
};

type ApplyMotionsOptions = {
  animate?: boolean;
  defaultDurationMs?: number;
  assumeDegrees?: boolean;
  jointNameMap?: Record<string, string>;
};

const TWO_PI = Math.PI * 2;

function toRadiansIfNeeded(angle: number, assumeDegrees?: boolean) {
  if (assumeDegrees) return (angle * Math.PI) / 180;
  if (Math.abs(angle) > TWO_PI + 1e-3) return (angle * Math.PI) / 180;
  return angle;
}

function getCurrentJointValue(viewer: URDFViewerElement, jointName: string): number {
  const robot: any = (viewer as any).robot;
  const j = robot?.joints?.[jointName];
  const v = j?.jointValue ?? j?.angle ?? j?.value ?? undefined;
  return typeof v === "number" ? v : 0;
}

export function applyJointMotionsToViewer(
  viewer: URDFViewerElement,
  motions: ViewerJointMotion[],
  opts: ApplyMotionsOptions = {}
) {
  if (!viewer) return;
  if (typeof (viewer as any).setJointValue !== "function") return;
  if (!motions?.length) return;

  const anyViewer = viewer as any;

  if (anyViewer.__motionRafId) {
    cancelAnimationFrame(anyViewer.__motionRafId);
    anyViewer.__motionRafId = null;
  }

  const animate = opts.animate ?? true;
  const defaultDurationMs = opts.defaultDurationMs ?? 350;
  const jointNameMap = opts.jointNameMap ?? {};

  const items = motions.map((m) => {
    const joint = jointNameMap[m.joint] ?? m.joint;
    const to = toRadiansIfNeeded(m.angle, opts.assumeDegrees);
    const from = getCurrentJointValue(viewer, joint);
    const durationMs =
      typeof m.time === "number" && m.time > 0 ? m.time * 1000 : defaultDurationMs;
    return { joint, from, to, durationMs };
  });

  if (!animate) {
    for (const it of items) {
      (viewer as any).setJointValue(it.joint, it.to);
    }
    viewer.redraw?.();
    return;
  }

  const start = performance.now();

  const tick = (now: number) => {
    let anyRunning = false;
    for (const it of items) {
      const t = Math.min(1, (now - start) / it.durationMs);
      const value = it.from + (it.to - it.from) * t;
      (viewer as any).setJointValue(it.joint, value);
      if (t < 1) anyRunning = true;
    }
    viewer.redraw?.();
    if (anyRunning) {
      anyViewer.__motionRafId = requestAnimationFrame(tick);
    } else {
      anyViewer.__motionRafId = null;
    }
  };

  anyViewer.__motionRafId = requestAnimationFrame(tick);
}