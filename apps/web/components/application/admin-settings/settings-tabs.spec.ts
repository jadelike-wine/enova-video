import { describe, expect, it } from 'vitest'

import { SETTINGS } from '../../../../../packages/db/src/settings-registry.js'
import {
  GENERAL_SECTIONS,
  SETTINGS_TABS,
  itemsForTab,
  settingBelongsToSection,
} from './settings-tabs.js'

describe('system settings metadata', () => {
  it('keeps the system settings tabs in the product order', () => {
    expect(SETTINGS_TABS.map((tab) => tab.key)).toEqual([
      'general',
      'agreement',
      'features',
      'security',
      'users',
      'ai',
      'gateway',
      'payment',
      'email',
      'backup',
    ])
  })

  it('keeps general sections in the sub2api-style business order', () => {
    expect(GENERAL_SECTIONS.map((section) => section.key)).toEqual([
      'branding',
      'table',
      'support',
      'homepage',
      'menu',
    ])
  })

  it('gives every registered setting an owning tab rule', () => {
    for (const setting of SETTINGS) {
      const owners = SETTINGS_TABS.filter((tab) => itemsForTab(tab, [setting]).length > 0)
      expect(owners.map((tab) => tab.key), setting.key).toHaveLength(1)
    }
  })

  it('gives every registered group an owning tab rule', () => {
    const registeredGroups = [...new Set(SETTINGS.map((setting) => setting.group))]

    for (const group of registeredGroups) {
      expect(
        SETTINGS_TABS.some((tab) => tab.groups.includes(group)),
        `missing tab rule for group ${group}`,
      ).toBe(true)
    }
  })

  it('uses explicit keys before group fallbacks for general sections', () => {
    const branding = GENERAL_SECTIONS.find((section) => section.key === 'branding')
    const table = GENERAL_SECTIONS.find((section) => section.key === 'table')
    const homepage = GENERAL_SECTIONS.find((section) => section.key === 'homepage')
    const menu = GENERAL_SECTIONS.find((section) => section.key === 'menu')

    expect(branding && homepage && table && menu).toBeTruthy()
    expect(settingBelongsToSection({ key: 'general.siteName', group: 'general' }, branding!)).toBe(true)
    expect(settingBelongsToSection({ key: 'general.homeContent', group: 'customization' }, homepage!)).toBe(true)
    expect(settingBelongsToSection({ key: 'general.homeContent', group: 'customization' }, branding!)).toBe(false)
    expect(settingBelongsToSection({ key: 'general.customMenuItems', group: 'customization' }, menu!)).toBe(true)
    expect(settingBelongsToSection({ key: 'table.defaultPageSize', group: 'table' }, table!)).toBe(true)
    expect(settingBelongsToSection({ key: 'table.defaultPageSize', group: 'table' }, branding!)).toBe(false)
  })

  it('places table pagination settings in the General tab', () => {
    const tableSettings = [
      { key: 'table.defaultPageSize', group: 'table' },
      { key: 'table.pageSizeOptions', group: 'table' },
    ]

    expect(itemsForTab(SETTINGS_TABS.find((tab) => tab.key === 'general')!, tableSettings).map((item) => item.key)).toEqual([
      'table.defaultPageSize',
      'table.pageSizeOptions',
    ])
    expect(itemsForTab(SETTINGS_TABS.find((tab) => tab.key === 'features')!, tableSettings)).toEqual([])
  })
})
