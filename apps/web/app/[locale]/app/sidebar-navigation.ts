export type SidebarRouteMatch = {
  path: string
  disabled?: boolean
}

export const assetNavItem = {
  path: '/app/assets',
  labelKey: 'navigation.assets',
} as const

export function shouldCloseMobileSidebarOnPathChange(previousPathname: string, pathname: string): boolean {
  return previousPathname !== pathname
}

export function getExpandableSidebarSubmenuId(itemPath: string): string {
  const normalizedPath = itemPath.replace(/^\/+|\/+$/g, '').replace(/[^a-zA-Z0-9_-]+/g, '-')
  return `sidebar-submenu-${normalizedPath || 'root'}`
}

/** Active styles belong only to the exact leaf route. */
export function isSidebarItemActive(pathname: string, itemPath: string): boolean {
  return itemPath !== '' && pathname === itemPath
}

export function getSidebarItemClass({
  pathname,
  itemPath,
  parent = false,
}: {
  pathname: string
  itemPath: string
  parent?: boolean
}): 'nav-item-active' | 'nav-item-inactive' {
  return !parent && isSidebarItemActive(pathname, itemPath)
    ? 'nav-item-active'
    : 'nav-item-inactive'
}

/** Parent menus use route matching only to decide whether they should be expanded. */
export function hasActiveSidebarChild(pathname: string, children: SidebarRouteMatch[]): boolean {
  return children.some(
    (child) =>
      child.path !== '' &&
      (pathname === child.path || pathname.startsWith(`${child.path}/`)),
  )
}
