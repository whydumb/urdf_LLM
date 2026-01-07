import { PluginInstance as DancePlugin } from "./dance/main";

export async function loadPlugins(agent?: unknown) {
  const dance = new DancePlugin(agent);
  if (typeof dance.init === "function") {
    await Promise.resolve(dance.init());
  }

  return {
    dance,
  } as const;
}
