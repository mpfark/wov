export interface Combat2ActorRef {
  type: 'character' | 'creature';
  id: string;
  name: string;
}

export interface Combat2SafeEvent {
  seq?: number;
  kind: string;
  actor?: Combat2ActorRef;
  target?: Combat2ActorRef;
  abilityKey?: string;
  amount?: number;
  hitQuality?: string;
  outcomeReason?: string;
  eventType?: string;
  actorCharacterId?: string;
  actorCreatureId?: string;
  targetCharacterId?: string;
  targetCreatureId?: string;
  occurredAt?: string;
  meta?: Record<string, unknown>;
}

export interface Combat2TickBatch {
  id: string;
  tick: number;
  createdAt: string;
  events: Combat2SafeEvent[];
}

export interface Combat2SyncResult {
  ok: true;
  kind: 'sync';
  latest_tick: number;
  returned_through_tick: number;
  has_more: boolean;
  encounter: { id: string; status: string; tick: number; stateVersion: number };
  character: Record<string, unknown>;
  fighter: Record<string, unknown> | null;
  creatures: Array<Record<string, unknown>>;
  effects: Array<Record<string, unknown>>;
  rewardClaims: Array<Record<string, unknown>>;
  batches: Combat2TickBatch[];
}

interface RpcResponse { data: unknown; error: { message?: string } | null }

export interface Combat2RealtimeChannel {
  on(
    type: 'postgres_changes',
    filter: { event: 'INSERT'; schema: 'public'; table: 'combat2_tick_notification'; filter: string },
    callback: (payload: { new?: unknown }) => void,
  ): Combat2RealtimeChannel;
  subscribe(callback?: (status: string) => void): Combat2RealtimeChannel;
}

export interface Combat2DeliveryClient {
  rpc(name: 'combat2_sync', args: {
    _character_id: string;
    _encounter_id: string;
    _after_tick: number;
    _limit: number;
  }): PromiseLike<RpcResponse>;
  channel(name: string): Combat2RealtimeChannel;
  removeChannel(channel: Combat2RealtimeChannel): unknown;
}

export interface Combat2DeliveryOptions {
  client: Combat2DeliveryClient;
  characterId: string;
  encounterId: string;
  pageSize?: number;
  onSync?: (result: Combat2SyncResult) => void;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseSync(value: unknown): Combat2SyncResult {
  const row = record(value);
  if (!row || row.ok !== true || row.kind !== 'sync' || !Array.isArray(row.batches) ||
      typeof row.latest_tick !== 'number' || typeof row.returned_through_tick !== 'number' ||
      typeof row.has_more !== 'boolean') {
    throw new Error('combat2_sync returned an invalid or refused response');
  }
  return row as unknown as Combat2SyncResult;
}

export class Combat2DeliveryAdapter {
  private readonly pageSize: number;
  private channel: Combat2RealtimeChannel | null = null;
  private disposed = false;
  private subscribedOnce = false;
  private pendingSync: Promise<Combat2SyncResult> | null = null;
  private syncAgain = false;
  private cursor = 0;

  constructor(private readonly options: Combat2DeliveryOptions) {
    this.pageSize = Math.max(1, Math.min(options.pageSize ?? 25, 50));
  }

  get lastAppliedTick(): number {
    return this.cursor;
  }

  async start(): Promise<Combat2SyncResult> {
    if (this.channel) return this.requestSync();
    this.disposed = false;
    this.channel = this.options.client
      .channel(`combat2-delivery-${this.options.characterId}-${this.options.encounterId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'combat2_tick_notification',
        filter: `encounter_id=eq.${this.options.encounterId}`,
      }, ({ new: value }) => {
        const notice = record(value);
        if (!notice || notice.encounter_id !== this.options.encounterId ||
            typeof notice.tick !== 'number' || notice.tick <= this.cursor) return;
        void this.requestSync().catch(() => undefined);
      })
      .subscribe((status) => {
        if (status !== 'SUBSCRIBED') return;
        if (this.subscribedOnce) void this.requestSync().catch(() => undefined);
        this.subscribedOnce = true;
      });
    return this.requestSync();
  }

  requestSync(): Promise<Combat2SyncResult> {
    if (this.disposed) return Promise.reject(new Error('Combat2 delivery adapter is stopped'));
    if (this.pendingSync) {
      this.syncAgain = true;
      return this.pendingSync;
    }
    this.pendingSync = this.runRequestedSyncs().finally(() => { this.pendingSync = null; });
    return this.pendingSync;
  }

  stop(): void {
    this.disposed = true;
    this.syncAgain = false;
    if (this.channel) this.options.client.removeChannel(this.channel);
    this.channel = null;
    this.subscribedOnce = false;
  }

  private async runRequestedSyncs(): Promise<Combat2SyncResult> {
    let result: Combat2SyncResult;
    do {
      this.syncAgain = false;
      result = await this.syncToLatest();
    } while (this.syncAgain && !this.disposed);
    return result!;
  }

  private async syncToLatest(): Promise<Combat2SyncResult> {
    const collected: Combat2TickBatch[] = [];
    let page: Combat2SyncResult;
    do {
      const beforePage = this.cursor;
      const { data, error } = await this.options.client.rpc('combat2_sync', {
        _character_id: this.options.characterId,
        _encounter_id: this.options.encounterId,
        _after_tick: this.cursor,
        _limit: this.pageSize,
      });
      if (error) throw new Error(error.message ?? 'combat2_sync failed');
      page = parseSync(data);
      if (page.returned_through_tick < this.cursor) throw new Error('combat2_sync cursor regressed');
      for (const batch of page.batches) {
        if (batch.tick <= this.cursor) continue;
        if (batch.tick !== this.cursor + 1) throw new Error('combat2_sync returned a tick gap');
        collected.push(batch);
        this.cursor = batch.tick;
      }
      if (page.returned_through_tick !== this.cursor) throw new Error('combat2_sync cursor did not match batches');
      if (page.has_more && this.cursor === beforePage) throw new Error('combat2_sync pagination made no progress');
    } while (page.has_more);

    const result = { ...page, batches: collected, returned_through_tick: this.cursor };
    if (!this.disposed) this.options.onSync?.(result);
    return result;
  }
}
