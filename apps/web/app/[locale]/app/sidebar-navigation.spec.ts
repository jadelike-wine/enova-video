import { describe, expect, it } from 'vitest'
import { assetNavItem, getExpandableSidebarSubmenuId, getSidebarItemClass, hasActiveSidebarChild, isSidebarItemActive, shouldCloseMobileSidebarOnPathChange } from './sidebar-navigation'

describe('sidebar route matching', () => {
  it('activates only the leaf item whose route exactly matches the pathname', () => {
    const pathname = '/app/images/history'

    expect(isSidebarItemActive(pathname, '/app/images/history')).toBe(true)
    expect(isSidebarItemActive(pathname, '/app/images')).toBe(false)
    expect(isSidebarItemActive(pathname, '/app/videos')).toBe(false)
  })

  it('keeps parent route matching available for expansion without making the parent active', () => {
    const pathname = '/app/images/history'
    const children = [
      { path: '/app/images' },
      { path: '/app/videos' },
    ]

    expect(hasActiveSidebarChild(pathname, children)).toBe(true)
    expect(isSidebarItemActive(pathname, '/app/images')).toBe(false)
    expect(getSidebarItemClass({ pathname, itemPath: '/app/images', parent: true })).toBe('nav-item-inactive')
  })

  it('does not treat a route with a similar prefix as the active item', () => {
    expect(isSidebarItemActive('/app/images/create', '/app/images')).toBe(false)
    expect(hasActiveSidebarChild('/app/images/create', [{ path: '/app/images' }])).toBe(true)
  })

  it('defines assets as a standalone first-level route', () => {
    expect(assetNavItem).toEqual({ path: '/app/assets', labelKey: 'navigation.assets' })
    expect(isSidebarItemActive('/app/assets', assetNavItem.path)).toBe(true)
  })

  it('closes an open mobile sidebar only after the pathname changes', () => {
    expect(shouldCloseMobileSidebarOnPathChange('/app/images', '/app/assets')).toBe(true)
    expect(shouldCloseMobileSidebarOnPathChange('/app/images', '/app/images')).toBe(false)
  })

  it('generates stable accessible ids for expandable submenus', () => {
    expect(getExpandableSidebarSubmenuId('/app/images')).toBe('sidebar-submenu-app-images')
    expect(getExpandableSidebarSubmenuId('/app/images')).toBe(getExpandableSidebarSubmenuId('/app/images'))
    expect(getExpandableSidebarSubmenuId('/app/videos')).not.toBe(getExpandableSidebarSubmenuId('/app/images'))
  })
})
