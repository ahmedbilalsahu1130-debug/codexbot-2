import type { PrismaClient } from '@prisma/client';

import { hashObject } from '../domain/models.js';

export type AuditLogInput = {
  step: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  reason?: string;
  inputs: unknown;
  outputs: unknown;
  paramsVersionId: string;
  metadata?: Record<string, unknown>;
};

export class AuditService {
  constructor(private readonly prisma: PrismaClient) {}

  async log(input: AuditLogInput): Promise<void> {
    await this.prisma.auditEvent.create({
      data: {
        step: input.step,
        level: input.level,
        message: input.message,
        reason: input.reason,
        inputsHash: hashObject(input.inputs),
        outputsHash: hashObject(input.outputs),
        paramsVersionId: input.paramsVersionId,
        metadata: input.metadata ?? null
      }
    });
  }
}
