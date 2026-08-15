'use client'

import { useMemo } from 'react'
import { useSiteConfig } from './useSiteConfig'

export const MIN_PAGE_SIZE = 5
export const MAX_PAGE_SIZE = 1000
export const DEFAULT_PAGE_SIZE = 20
export const DEFAULT_PAGE_SIZE_OPTIONS = [10, 20, 50, 100]

/**
 * 统一表格分页 Hook：从全局 SiteConfig 读取默认每页条数和可选条数列表。
 * 后台与用户侧表格组件统一使用此 Hook，不再各自硬编码。
 */
export function useTablePagination() {
  const { config } = useSiteConfig()

  const defaultPageSize = useMemo(() => {
    const size = config.tableDefaultPageSize
    return Number.isInteger(size) && size >= MIN_PAGE_SIZE && size <= MAX_PAGE_SIZE
      ? size
      : DEFAULT_PAGE_SIZE
  }, [config.tableDefaultPageSize])

  const pageSizeOptions = useMemo(() => {
    const options = config.tablePageSizeOptions
    if (!Array.isArray(options) || options.length === 0) {
      return [...DEFAULT_PAGE_SIZE_OPTIONS]
    }
    const valid = Array.from(
      new Set(
        options
          .filter((n) => Number.isInteger(n) && n >= MIN_PAGE_SIZE && n <= MAX_PAGE_SIZE)
      )
    ).sort((a, b) => a - b)
    return valid.length > 0 ? valid : [...DEFAULT_PAGE_SIZE_OPTIONS]
  }, [config.tablePageSizeOptions])

  return {
    defaultPageSize,
    pageSizeOptions,
  }
}
