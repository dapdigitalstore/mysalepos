import { BadRequestException } from '@nestjs/common';

export const DURATION_TYPES = ['days', 'months', 'years'] as const;
export type DurationType = (typeof DURATION_TYPES)[number];

export interface WarrantyInput {
  name: string;
  description?: string | null;
  duration: number;
  durationType: string;
}

export interface WarrantyColumns {
  name: string;
  description: string | null;
  duration: number;
  duration_type: DurationType;
}

export function isDurationType(v: string): v is DurationType {
  return (DURATION_TYPES as readonly string[]).includes(v);
}

/** Validates a warranty and returns the columns to store (blank description becomes null). */
export function normalizeWarranty(input: WarrantyInput): WarrantyColumns {
  const name = (input.name ?? '').trim();
  if (!name) throw new BadRequestException('Name is required');
  if (!Number.isInteger(input.duration) || input.duration < 1) {
    throw new BadRequestException('Duration must be a whole number of at least 1');
  }
  if (!isDurationType(input.durationType)) throw new BadRequestException('Duration type must be days, months or years');
  const description = (input.description ?? '').trim();
  return { name, description: description || null, duration: input.duration, duration_type: input.durationType };
}

/** "Name (12 months)" as shown in the product form dropdown. A duration of 1 is singular. */
export function warrantyLabel(name: string, duration: number, durationType: string): string {
  const unit = duration === 1 && durationType.endsWith('s') ? durationType.slice(0, -1) : durationType;
  return `${name} (${duration} ${unit})`;
}

/**
 * When a warranty that starts on `start` ends (port of Warranty::getEndDate). Calendar math in UTC; like Carbon,
 * adding months overflows into the next month when the day does not exist (31 Jan + 1 month = 3 Mar).
 */
export function warrantyEndDate(start: Date, duration: number, durationType: string): Date {
  const end = new Date(start.getTime());
  if (durationType === 'days') end.setUTCDate(end.getUTCDate() + duration);
  else if (durationType === 'months') end.setUTCMonth(end.getUTCMonth() + duration);
  else if (durationType === 'years') end.setUTCFullYear(end.getUTCFullYear() + duration);
  return end;
}

/** A warranty used by products or sold lines cannot be deleted. */
export function assertWarrantyDeletable(usage: { products: number; sellLines: number }): void {
  if (usage.products > 0 || usage.sellLines > 0) {
    throw new BadRequestException('This warranty is used by products or sales and cannot be deleted');
  }
}
