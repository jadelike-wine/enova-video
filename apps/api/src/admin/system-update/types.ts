/** GitHub Release 的 API 响应（仅本项目需要的字段）。 */
export interface GitHubRelease {
  tag_name: string;
  name: string;
  body: string;
  published_at: string;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
  assets: Array<{ name: string; browser_download_url: string; size: number }>;
}

/** 更新检查的对外视图（供后端管理页展示）。 */
export interface UpdateInfoView {
  enabled: boolean;
  current_version: string;
  latest_version: string;
  has_update: boolean;
  release_info?: {
    name: string;
    body: string;
    published_at: string;
    html_url: string;
  };
  cached: boolean;
  warning?: string;
}

/** 可回滚版本的对外视图。 */
export interface RollbackVersionView {
  version: string;
  published_at: string;
  html_url: string;
}

export type OperationStatus = 'running' | 'success' | 'failed';

/** 一次后台更新/回滚操作的对外视图（用于前端轮询进度）。 */
export interface OperationView {
  operation_id: string;
  status: OperationStatus;
  action: 'update' | 'rollback';
  target?: string;
  output?: string;
  exit_code?: number;
  started_at?: string;
  finished_at?: string;
}