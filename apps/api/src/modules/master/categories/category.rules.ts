import { BadRequestException } from '@nestjs/common';

/**
 * Categories are two levels deep: a main category (parent_id = 0) and its sub-categories.
 * A category cannot be its own parent, and a main category that already has sub-categories cannot become a sub-category.
 */
export function assertValidParent(opts: { selfId?: number; parentId: number; parentIsMain: boolean; selfHasChildren?: boolean }): void {
  const { selfId, parentId, parentIsMain, selfHasChildren } = opts;
  if (parentId === 0) return;
  if (selfId !== undefined && selfId === parentId) throw new BadRequestException('A category cannot be its own parent');
  if (!parentIsMain) throw new BadRequestException('Sub-categories can only be added under a main category');
  if (selfHasChildren) throw new BadRequestException('A category with sub-categories cannot become a sub-category');
}
