export type Vista = 'a' | 'b'

declare module 'claude-code' {
  interface PluginState {
    'huddle-sonda': { vista: Vista }
  }
}
