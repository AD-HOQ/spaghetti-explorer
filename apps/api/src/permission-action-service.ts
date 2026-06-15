import { PermissionActionEventType, PermissionActionRecord } from "./permission-action-log-store.js";

type ActionEventWriter = {
  append(action: PermissionActionRecord, eventType: PermissionActionEventType, message?: string | null): Promise<unknown>;
};

export type PermissionActionExecutionResult = {
  message: string;
  executedAt: string;
};

export class PermissionActionService {
  constructor(private readonly logs: ActionEventWriter) {}

  async execute(
    action: PermissionActionRecord,
    executor: () => Promise<PermissionActionExecutionResult>,
  ) {
    await this.logs.append(action, "running", "Action execution started.");
    try {
      const result = await executor();
      await this.logs.append(action, "succeeded", result.message);
      return result;
    } catch (error) {
      await this.logs.append(action, "failed", error instanceof Error ? error.message : "Action execution failed.");
      throw error;
    }
  }
}
