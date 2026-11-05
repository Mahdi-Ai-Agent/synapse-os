/** Protected desktop runs retain conversation history only in the encrypted Synapse vault. */
export function cliSessionArgs(engine: 'claude' | 'codex', request: { ephemeral?: boolean; sessionId?: string }): string[] {
  if (request.ephemeral) return [engine === 'claude' ? '--no-session-persistence' : '--ephemeral'];
  return request.sessionId ? [engine === 'claude' ? '--resume' : 'resume', request.sessionId] : [];
}
