import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import type { BrainEngine, BrainEvent, BrainRunRequest, EngineId } from '@synapse/brain';
import { createVault } from '@synapse/vault-template';
import { BrainRunner } from '../src/brain-runner';
import { VaultService } from '../src/vault-service';
import { VaultGit } from '../src/vault-git';
import { SettingsStore } from '../src/settings';
it('keeps private conversation continuity inside the vault without resuming vendor sessions', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'synapse-private-runner-'));
  const requests: BrainRunRequest[]=[];const contexts:string[]=[];
  const engine:BrainEngine={id:'claude-cli',name:'fake',auth:'cli-login',models:()=>[{id:'fake',label:'Fake'}],efforts:()=>[],probe:async()=>({installed:true,loggedIn:true,checkedAt:new Date().toISOString()}),
    run(req){requests.push(req);return(async function*(){contexts.push(await fs.readFile(req.systemAppendFile!,'utf8'));yield{type:'init',sessionId:'vendor-id'}as BrainEvent;yield{type:'result',text:'I remember the blue project.',sessionId:'vendor-id',isError:false}as BrainEvent;})();}};
  let vault:VaultService|undefined;
  try {
    await createVault(root);vault=new VaultService(root);await vault.start();const git=new VaultGit(root);await git.ensureRepo();
    const runner=new BrainRunner(vault,git,new Map<EngineId,BrainEngine>([['claude-cli',engine]]),new SettingsStore(root),{privateSessions:true});
    async function turn(prompt:string,threadId?:string){const done=new Promise<void>(resolve=>runner.once('done',()=>resolve()));const started=await runner.start({mode:'chat',prompt,...(threadId?{threadId}:{})});await done;return started.threadId;}
    const id=await turn('The blue project is important.');await turn('What project did I mention?',id);
    expect(requests).toHaveLength(2);expect(requests.every(r=>r.ephemeral===true&&r.sessionId===undefined)).toBe(true);
    expect(contexts[1]).toContain('The blue project is important.');expect(contexts[1]).toContain('I remember the blue project.');
    const saved=await fs.readFile(path.join(root,'.synapse','sessions.json'),'utf8');expect(saved).toContain('The blue project is important.');expect(saved).toContain('What project did I mention?');
  } finally {await vault?.stop();await fs.rm(root,{recursive:true,force:true});}
},30000);

it('stopAll cancels the run at work and waits for it, so its edits are committed', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'synapse-stopall-'));
  let vault: VaultService | undefined;
  const engine: BrainEngine = { id: 'claude-cli', name: 'slow', auth: 'cli-login', models: () => [{ id: 'fake', label: 'Fake' }], efforts: () => [], probe: async () => ({ installed: true, loggedIn: true, checkedAt: new Date().toISOString() }),
    run(req, signal) {
      return (async function* () {
        await fs.writeFile(path.join(req.cwd, 'nodes', 'notes', 'half.md'), '---\ntype: note\ntitle: Half\nsummary: half done\n---\n', 'utf8');
        yield { type: 'init', sessionId: 's' } as BrainEvent;
        await new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve(), { once: true }));
      })();
    } };
  try {
    await createVault(root); vault = new VaultService(root); await vault.start(); const git = new VaultGit(root); await git.ensureRepo();
    const runner = new BrainRunner(vault, git, new Map<EngineId, BrainEngine>([['claude-cli', engine]]), new SettingsStore(root));
    const done = new Promise<{ ok: boolean; error?: string }>((resolve) => runner.once('done', resolve));
    await runner.start({ mode: 'chat', prompt: 'write half' });
    await new Promise((r) => setTimeout(r, 300));
    await runner.stopAll(5000);
    expect((await done).error).toBe('cancelled');
    expect((await git.log(1))[0]?.subject ?? '').toMatch(/^brain\(chat\)/);
  } finally { await vault?.stop(); await fs.rm(root, { recursive: true, force: true }); }
}, 30000);
