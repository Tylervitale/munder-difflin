import { AgentUsageSample } from './usage';
import type { HiveManager } from './hive';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Providers and their token usage limits (hypothetical default token limits for now, as provider sets them)
const PROVIDER_LIMITS: Record<string, { fiveHour: number, weekly: number }> = {
  claude: { fiveHour: 1000000, weekly: 10000000 },
  codex: { fiveHour: 500000, weekly: 5000000 },
  gemini: { fiveHour: 800000, weekly: 8000000 },
  cursor: { fiveHour: 500000, weekly: 5000000 },
  default: { fiveHour: 500000, weekly: 5000000 }
};

interface AgentLimitState {
  usageHistory: { ts: number, tokens: number }[];
  warned5h: boolean;
  warnedWeekly: boolean;
  lastUsage: number;
}

export class UsageLimitTracker {
  private agentStates: Map<string, AgentLimitState> = new Map();
  private hive: HiveManager;
  private persistPath: string | null = null;

  constructor(hive: HiveManager) {
    this.hive = hive;

    // Setup persistent storage
    const hiveRoot = hive.root();
    if (hiveRoot) {
      this.persistPath = join(hiveRoot, 'usage-limits.json');
      this.loadState();
    }
  }

  private loadState() {
    if (this.persistPath && existsSync(this.persistPath)) {
      try {
        const data = readFileSync(this.persistPath, 'utf8');
        const parsed = JSON.parse(data);
        for (const key in parsed) {
          this.agentStates.set(key, parsed[key]);
        }
      } catch (err) {
        console.error('Failed to load usage limits state', err);
      }
    }
  }

  private saveState() {
    if (this.persistPath) {
      try {
        const data: Record<string, AgentLimitState> = {};
        for (const [key, val] of this.agentStates.entries()) {
          data[key] = val;
        }
        writeFileSync(this.persistPath, JSON.stringify(data, null, 2), 'utf8');
      } catch (err) {
        console.error('Failed to save usage limits state', err);
      }
    }
  }

  public recordUsage(sample: AgentUsageSample, provider: string) {
    const ts = sample.ts;
    // We only care about tokens spent
    const tokens = sample.input + sample.output;
    const state = this.getAgentState(sample.agentId);

    // Delta tracking because we receive cumulative usage from getAgentUsage/onAgentUsage
    let delta = tokens;
    if (state.lastUsage !== undefined && state.lastUsage <= tokens) {
       delta = tokens - state.lastUsage;
    }
    state.lastUsage = tokens;

    if (delta > 0) {
      state.usageHistory.push({ ts, tokens: delta });
    }

    // Clean up history older than 7 days
    const sevenDaysAgo = ts - 7 * 24 * 60 * 60 * 1000;
    state.usageHistory = state.usageHistory.filter(h => h.ts >= sevenDaysAgo);

    this.checkLimits(sample.agentId, provider, ts);
    this.saveState();
  }

  private getAgentState(agentId: string): AgentLimitState {
    if (!this.agentStates.has(agentId)) {
      this.agentStates.set(agentId, { usageHistory: [], warned5h: false, warnedWeekly: false, lastUsage: 0 });
    }
    return this.agentStates.get(agentId)!;
  }

  private checkLimits(agentId: string, provider: string, now: number) {
    const state = this.getAgentState(agentId);
    const limits = PROVIDER_LIMITS[provider] || PROVIDER_LIMITS.default;

    const fiveHoursAgo = now - 5 * 60 * 60 * 1000;
    let fiveHourUsage = 0;
    let weeklyUsage = 0;

    for (const h of state.usageHistory) {
      weeklyUsage += h.tokens;
      if (h.ts >= fiveHoursAgo) {
        fiveHourUsage += h.tokens;
      }
    }

    if (fiveHourUsage >= limits.fiveHour * 0.85 && !state.warned5h) {
      state.warned5h = true;
      this.hive.send({
        to: agentId,
        act: 'inform',
        subject: 'Usage Limit Warning',
        body: `You have hit 85% of your 5-hour usage window limit. Please write a handoff to Michael or another agent so work can continue without interruption.`
      }, 'system');
    } else if (fiveHourUsage < limits.fiveHour * 0.85) {
      state.warned5h = false;
    }

    if (weeklyUsage >= limits.weekly * 0.95 && !state.warnedWeekly) {
      state.warnedWeekly = true;
      this.hive.send({
        to: agentId,
        act: 'inform',
        subject: 'Usage Limit Warning',
        body: `You have hit 95% of your weekly usage limit. Please write a handoff to Michael or another agent immediately.`
      }, 'system');
    } else if (weeklyUsage < limits.weekly * 0.95) {
      state.warnedWeekly = false;
    }
  }
}
