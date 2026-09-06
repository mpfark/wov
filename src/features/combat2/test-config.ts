import { isCombat2TestArenaNode } from './arena-identity';
/** Arena location reserves legacy authority before asynchronous access is known. */
export const combat2ArenaReservesLegacy = isCombat2TestArenaNode;
/** The feature switch controls whether a reserved arena page may begin its self-access check. */
export function combat2ArenaAccessCheckEnabled(enabled:boolean,nodeId:string|null|undefined){return enabled&&isCombat2TestArenaNode(nodeId);}
