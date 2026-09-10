import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';

const node=process.execPath;
if(process.argv.includes('--probe-failure')){
  console.error('[FAIL] representative release blocker');
  process.exit(1);
}
const gates=[
  ['edge mirror parity',[node,'scripts/generate-combat2-edge-mirror.mjs','--check']],
  ['focused compatibility and safety',[node,'node_modules/vitest/vitest.mjs','run',
    'src/shared/combat2/__tests__/ability-support.test.ts',
    'src/shared/combat2/__tests__/catalog.test.ts',
    'src/shared/combat2/__tests__/boss-claim-contract.test.ts',
    'src/shared/combat2/__tests__/final-ability-closure.test.ts',
    'src/server/combat2/__tests__/canary-control-migration.test.ts',
    'src/server/combat2/__tests__/test-arena-lifecycle-repair-migration.test.ts',
    'src/server/combat2/__tests__/readiness-command.test.ts',
    'src/server/combat2/__tests__/edge-packaging.test.ts',
    'src/server/combat2/__tests__/dispatch-node-ticks-once.test.ts',
    'src/server/combat2/__tests__/process-node-tick-once.test.ts',
    'src/server/combat2/__tests__/rewards-loot-migration.test.ts',
    'src/server/combat2/__tests__/equipment-durability-migration.test.ts',
    'src/server/combat2/__tests__/party-movement-migration.test.ts',
    'src/server/combat2/__tests__/respawn-migration.test.ts',
    'src/features/combat2/controlled-ownership.test.tsx',
    'src/features/combat2/legacy-execution.test.tsx',
    'src/features/combat2/delivery.test.ts']],
  ['root TypeScript',[node,'node_modules/typescript/bin/tsc','--noEmit']],
  ['application TypeScript',[node,'node_modules/typescript/bin/tsc','--noEmit','-p','tsconfig.app.json']],
  ['production build',[node,'node_modules/vite/bin/vite.js','build']],
];

const packageJson=JSON.parse(readFileSync('package.json','utf8'));
if(packageJson.scripts?.['combat2:readiness']!=='node scripts/combat2-readiness.mjs'){
  console.error('[FAIL] readiness command is not canonical'); process.exit(1);
}
for(const [name,args] of gates){
  console.log(`\n[GATE] ${name}`);
  const result=spawnSync(args[0],args.slice(1),{stdio:'inherit',shell:false});
  if(result.status!==0){console.error(`[FAIL] ${name}`);process.exit(result.status??1);}
  console.log(`[PASS] ${name}`);
}
console.log('\nCombat2 repository readiness gates passed. Cloud catalogue, installed migration, mode/world state, secrets, and deployment SHA still require deployment preflight.');
