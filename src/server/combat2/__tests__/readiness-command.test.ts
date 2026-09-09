import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {describe,expect,it} from 'vitest';

describe('Combat2 readiness command',()=>{
  it('is canonical and contains the mandatory local gate classes',()=>{
    const pkg=JSON.parse(readFileSync('package.json','utf8'));
    const source=readFileSync('scripts/combat2-readiness.mjs','utf8');
    expect(pkg.scripts['combat2:readiness']).toBe('node scripts/combat2-readiness.mjs');
    for(const gate of ['edge mirror parity','focused compatibility and safety','root TypeScript','application TypeScript','production build'])
      expect(source).toContain(gate);
  });
  it('exits non-zero and identifies a representative blocker',()=>{
    const result=spawnSync(process.execPath,['scripts/combat2-readiness.mjs','--probe-failure'],{encoding:'utf8'});
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('representative release blocker');
  });
});
