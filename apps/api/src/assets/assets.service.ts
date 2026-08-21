import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, lte } from 'drizzle-orm';
import type { AssetType } from '@enova/contracts';
import { assets, generationJobs, type Database } from '@enova/db';
import { DATABASE } from '../database/database.module.js';
import {
  ASSET_LIST_TYPES,
  ASSET_SORTS,
  type ListAssetsDto,
} from './dto/list-assets.dto.js';

export interface AssetView {
  id: string;
  type: AssetType;
  url: string | null;
  mimeType: string | null;
  size: number;
  width: number | null;
  height: number | null;
  duration: number | null;
  createdAt: string;
  generationId: string | null;
  prompt: string | null;
}

@Injectable()
export class AssetsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async list(workspaceId: string, dto: ListAssetsDto): Promise<AssetView[]> {
    const conditions = [eq(assets.workspaceId, workspaceId)];
    const type = dto.type ?? ASSET_LIST_TYPES.ALL;

    if (type !== ASSET_LIST_TYPES.ALL) {
      conditions.push(eq(assets.type, type));
    }
    if (dto.from) {
      conditions.push(gte(assets.createdAt, new Date(dto.from)));
    }
    if (dto.to) {
      conditions.push(lte(assets.createdAt, new Date(dto.to)));
    }

    const rows = await this.db
      .select({ asset: assets, generation: generationJobs })
      .from(assets)
      .leftJoin(generationJobs, eq(assets.generationJobId, generationJobs.id))
      .where(and(...conditions))
      .orderBy(
        (dto.sort ?? ASSET_SORTS.NEWEST) === ASSET_SORTS.OLDEST
          ? asc(assets.createdAt)
          : desc(assets.createdAt),
      )
      .limit(dto.limit ?? 60);

    return rows.map(({ asset, generation }) => this.toView(asset, generation));
  }

  private toView(
    asset: {
      id: string;
      type: AssetType;
      mimeType: string | null;
      size: number;
      width: number | null;
      height: number | null;
      duration: number | null;
      createdAt: Date;
    },
    generation: {
      id: string;
      inputJson: Record<string, unknown> | null;
      outputJson: Record<string, unknown> | null;
    } | null,
  ): AssetView {
    const outputUrl = generation?.outputJson?.url;
    const prompt = generation?.inputJson?.prompt;

    return {
      id: asset.id,
      type: asset.type,
      url: typeof outputUrl === 'string' ? outputUrl : null,
      mimeType: asset.mimeType,
      size: asset.size,
      width: asset.width,
      height: asset.height,
      duration: asset.duration,
      createdAt: asset.createdAt.toISOString(),
      generationId: generation?.id ?? null,
      prompt: typeof prompt === 'string' ? prompt : null,
    };
  }
}
